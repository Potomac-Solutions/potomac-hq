// Site monitoring: add a client's website, stop watching it, see how each is
// doing, and the check HQ runs every few minutes. Seen with `client.view`,
// changed with `client.edit`. Alerts go to Potomac's alert address.
import { afterCheck, cleanSiteUrl, lasted, uptime, type Change, type Site } from "../domain/site.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { dueText, err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { SiteAlert, SiteChecker, SiteStore } from "./ports.ts";

export type MonitorDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly sites: SiteStore;
  readonly clientName: (organizationId: Id) => string | null;
  readonly today: () => string;
  readonly formatWhen: (instant: string) => string;
};

type Refused = "forbidden" | "not-found";
const allowed = (deps: MonitorDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;
const MAX_SITES = 200;

export function addSite(deps: MonitorDeps, actorId: Id | null, organizationId: Id, typed: string): Result<Site, Refused | "url-invalid" | "url-not-public" | "already-watched" | "too-many"> {
  if (!allowed(deps, actorId, "client.edit")) return err("forbidden");
  const url = cleanSiteUrl(typed);
  if (!url.ok) return url;
  return deps.transact(() => {
    if (deps.clientName(organizationId) === null) return err("not-found");
    const all = deps.sites.listActive();
    if (all.length >= MAX_SITES) return err("too-many");
    if (all.some((one) => one.url === url.value)) return err("already-watched");
    const site: Site = { id: deps.newId(), organizationId, url: url.value, active: true, state: "unknown", failures: 0, downSince: null, lastCheckedAt: null, lastResult: "Not checked yet", certExpiresOn: null, certWarnedFor: null };
    deps.sites.insert(site, deps.clock());
    recordActivity(deps, { actorId, action: "site.watched", recordType: "site", recordId: site.id, context: { organizationId, url: site.url } });
    return ok(site);
  });
}

export function stopWatching(deps: MonitorDeps, actorId: Id | null, id: Id): Result<Site, Refused> {
  if (!allowed(deps, actorId, "client.edit")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.sites.get(id);
    if (!found || !found.active) return err("not-found");
    const stopped = { ...found, active: false };
    deps.sites.save(stopped, deps.clock());
    deps.sites.endOutage(id, deps.clock());
    recordActivity(deps, { actorId, action: "site.unwatched", recordType: "site", recordId: id, context: { organizationId: found.organizationId, url: found.url } });
    return ok(stopped);
  });
}

export type SiteLine = {
  readonly id: string;
  readonly organizationId: string;
  readonly clientName: string;
  readonly url: string;
  readonly host: string;
  readonly state: string;
  readonly stateLabel: string;
  readonly lastResult: string;
  readonly checked: string;
  readonly since: string;
  readonly uptime: string;
  readonly cert: string;
  readonly certSoon: boolean;
  readonly outages: readonly { readonly when: string; readonly lasted: string; readonly reason: string }[];
};

function lineOf(deps: MonitorDeps, site: Site): SiteLine {
  const now = deps.clock();
  const from = Temporal.Instant.from(now).subtract({ hours: 24 * 30 }).toString();
  const outages = deps.sites.outages(site.id, from);
  const today = deps.today();
  const certDays = site.certExpiresOn ? Temporal.PlainDate.from(today).until(site.certExpiresOn).days : null;
  return {
    id: site.id,
    organizationId: site.organizationId,
    clientName: deps.clientName(site.organizationId) ?? "A removed client",
    url: site.url,
    host: new URL(site.url).host,
    state: site.state,
    stateLabel: site.state === "up" ? "Up" : site.state === "down" ? "Down" : "Not checked yet",
    lastResult: site.lastResult,
    checked: site.lastCheckedAt ? deps.formatWhen(site.lastCheckedAt) : "",
    since: site.state === "down" && site.downSince ? `for ${lasted(site.downSince, now)}` : "",
    uptime: uptime(outages, from, now),
    cert: site.certExpiresOn ? `Certificate runs out ${dueText(site.certExpiresOn, today)}` : "",
    certSoon: certDays !== null && certDays <= 14,
    outages: outages.slice(0, 5).map((one) => ({ when: deps.formatWhen(one.start), lasted: one.end ? lasted(one.start, one.end) : "still down", reason: one.reason })),
  };
}

export type SitesView = { readonly sites: readonly SiteLine[]; readonly down: number; readonly heading: string; readonly canEdit: boolean };

const headingOf = (sites: readonly SiteLine[]): string => {
  const down = sites.filter((one) => one.state === "down").length;
  const up = sites.filter((one) => one.state === "up").length;
  if (down > 0) return `${down} down`;
  return up === sites.length ? `All ${up} up` : `${sites.length} watched, ${sites.length - up} not checked yet`;
};

/** Every watched site, down ones first. Permission: `client.view`. */
export function allSites(deps: MonitorDeps, actorId: Id | null): Result<SitesView, "forbidden"> {
  if (!allowed(deps, actorId, "client.view")) return err("forbidden");
  const order = { down: 0, unknown: 1, up: 2 };
  const sites = deps.sites.listActive().toSorted((a, b) => order[a.state] - order[b.state]).map((one) => lineOf(deps, one));
  return ok({ sites, down: sites.filter((one) => one.state === "down").length, heading: headingOf(sites), canEdit: allowed(deps, actorId, "client.edit") });
}

export function clientSites(deps: MonitorDeps, actorId: Id | null, organizationId: Id): Result<SitesView, "forbidden"> {
  if (!allowed(deps, actorId, "client.view")) return err("forbidden");
  const sites = deps.sites.listFor(organizationId).map((one) => lineOf(deps, one));
  return ok({ sites, down: sites.filter((one) => one.state === "down").length, heading: headingOf(sites), canEdit: allowed(deps, actorId, "client.edit") });
}

/** Sites down now, or with a certificate running out, for the dashboard. */
export function sitesNeedingAttention(deps: MonitorDeps, actorId: Id | null): readonly SiteLine[] {
  if (!allowed(deps, actorId, "client.view")) return [];
  return deps.sites
    .listActive()
    .map((one) => lineOf(deps, one))
    .filter((one) => one.state === "down" || one.certSoon);
}

function alertFor(deps: MonitorDeps, site: Site, change: Change, now: string): { subject: string; body: string } {
  const client = deps.clientName(site.organizationId) ?? "a client";
  const host = new URL(site.url).host;
  if (change.kind === "down") return { subject: `Down: ${host} (${client})`, body: `${site.url} is down: ${change.reason}.\n\nIt failed two checks in a row, five minutes apart. HQ keeps checking and will say when it's back.` };
  if (change.kind === "up") return { subject: `Back up: ${host} (${client})`, body: `${site.url} is back up after ${lasted(change.downSince, now)}.` };
  return { subject: `Certificate running out: ${host} (${client})`, body: `The certificate for ${site.url} runs out ${dueText(change.expiresOn, deps.today())}. Renew it, or check that automatic renewal is working.` };
}

/**
 * Checks every watched site, a few at a time, and saves what it finds. An
 * outage starts when a site goes down and ends when it is back. Each change
 * is alerted once. Run by HQ every five minutes.
 */
export async function checkSites(deps: MonitorDeps, check: SiteChecker, alert: SiteAlert | null): Promise<{ readonly checked: number; readonly down: number; readonly alerted: number }> {
  const sites = deps.sites.listActive();
  let alerted = 0;
  let down = 0;
  const queue = [...sites];
  const worker = async () => {
    for (let site = queue.shift(); site; site = queue.shift()) {
      const result = await check(site.url);
      const now = deps.clock();
      const changes = deps.transact(() => {
        const current = deps.sites.get(site.id);
        if (!current || !current.active) return [];
        const next = afterCheck(current, result, now, deps.today());
        deps.sites.save(next.site, now);
        for (const change of next.changes) {
          if (change.kind === "down") deps.sites.startOutage(site.id, now, change.reason);
          if (change.kind === "up") deps.sites.endOutage(site.id, now);
          if (change.kind !== "cert") recordActivity(deps, { actorId: null, action: change.kind === "down" ? "site.down" : "site.up", recordType: "site", recordId: site.id, context: { organizationId: site.organizationId, url: site.url } });
        }
        if (next.site.state === "down") down++;
        return next.changes.map((change) => alertFor(deps, next.site, change, now));
      });
      for (const message of changes) if (alert && (await alert(message).catch(() => false))) alerted++;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { checked: sites.length, down, alerted };
}
