// Where leads come from (decision 0013, section 2). The inquiry form, the
// website's booking and the 60-second planner pass on where on the site the
// person was; HQ keeps the first for each opportunity, shows it on the
// opportunity, and counts what became of each source's leads.
import { cleanTouch, funnel, PERIODS, rate, sourceOf, type LeadTouch } from "../domain/source.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, formatMoney, ok, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { LeadStore } from "./ports.ts";

export type LeadsDeps = {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly clock: () => string;
  readonly leads: LeadStore;
  /** An opportunity's lead source and referral code, to read its line. Null when it doesn't exist. */
  readonly opportunityOf: (id: Id) => { readonly leadSource: string; readonly referralCode: string | null } | null;
};

export type RawTouch = { readonly src?: string | undefined; readonly path?: string | undefined; readonly utmSource?: string | undefined; readonly utmMedium?: string | undefined; readonly utmCampaign?: string | undefined };

/** The touch fields a form or the website's JSON may carry, by their names there. */
export function touchFields(read: (name: string) => string | undefined): RawTouch {
  const one = (name: string): string | undefined => read(name);
  return { src: one("src"), path: one("page") ?? one("path"), utmSource: one("utm_source"), utmMedium: one("utm_medium"), utmCampaign: one("utm_campaign") };
}

/**
 * Keeps where a new lead came from, for an opportunity or the newest open one
 * at a client. HQ does this by itself as the lead arrives, so there is no
 * actor and no activity event: the opportunity's own event says it arrived,
 * and a touch is a fact about it, not a change anyone made.
 */
export function keepLeadTouch(deps: LeadsDeps, target: { readonly opportunityId: Id } | { readonly organizationId: Id }, raw: RawTouch): LeadTouch | null {
  const touch = cleanTouch(raw);
  if (!touch) return null;
  return deps.transact(() => {
    const opportunityId = "opportunityId" in target ? target.opportunityId : deps.leads.newestOpenAt(target.organizationId);
    if (!opportunityId || !deps.opportunityOf(opportunityId)) return null;
    deps.leads.keepFirst(opportunityId, touch, deps.clock());
    return touch;
  });
}

export type LeadOrigin = { readonly label: string; readonly page: string; readonly campaign: string };

/** Where an opportunity came from, for its page. Null when the site said nothing about it. */
export function leadOrigin(deps: LeadsDeps, actorId: Id | null, opportunityId: Id): LeadOrigin | null {
  if (actorId === null || !authorize(deps, actorId, "opportunity.view").ok) return null;
  const touch = deps.leads.get(opportunityId);
  const opportunity = deps.opportunityOf(opportunityId);
  if (!touch || !opportunity) return null;
  const campaign = [touch.utmSource, touch.utmMedium, touch.utmCampaign].filter(Boolean).join(" · ");
  return { label: sourceOf({ ...opportunity, src: touch.src, utmSource: touch.utmSource }).label, page: touch.path, campaign };
}

export type LeadSourcesView = {
  readonly days: string;
  readonly periods: readonly { readonly value: string; readonly label: string }[];
  readonly showValue: boolean;
  readonly total: { readonly leads: number; readonly calls: number; readonly proposals: number; readonly won: number; readonly wonText: string };
  readonly lines: readonly { readonly key: string; readonly label: string; readonly leads: number; readonly calls: string; readonly proposals: string; readonly won: string; readonly wonText: string }[];
  /** Website leads that came with nothing to say where on the site. */
  readonly unknown: number;
};

const PERIOD_LABELS: Readonly<Record<number, string>> = { 30: "The last 30 days", 90: "The last 90 days", 365: "The last year" };
const share = (part: number, whole: number) => (whole === 0 ? "0" : `${part} (${rate(part, whole)})`);

/** The lead sources report: each source's leads in the period, and how many had a call, got a proposal and were won. */
export function leadSources(deps: LeadsDeps, actorId: Id | null, typedDays: string): Result<LeadSourcesView, "forbidden"> {
  if (actorId === null || !authorize(deps, actorId, "report.view").ok) return err("forbidden");
  const days = (PERIODS as readonly number[]).includes(Number(typedDays)) ? Number(typedDays) : 90;
  const now = deps.clock();
  const since = Temporal.Instant.from(now).subtract({ hours: 24 * days }).toString();
  const rows = deps.leads.rows(since, now);
  const showValue = authorize(deps, actorId, "opportunity.view-value").ok;
  const dollars = (minor: number) => (showValue ? formatMoney({ minor, currency: "USD" }) : "");
  const lines = funnel(rows);
  const total = lines.reduce((sum, line) => ({ leads: sum.leads + line.leads, calls: sum.calls + line.calls, proposals: sum.proposals + line.proposals, won: sum.won + line.won, wonMinor: sum.wonMinor + line.wonMinor }), { leads: 0, calls: 0, proposals: 0, won: 0, wonMinor: 0 });
  return ok({
    days: String(days),
    periods: PERIODS.map((value) => ({ value: String(value), label: PERIOD_LABELS[value] ?? `${value} days` })),
    showValue,
    total: { leads: total.leads, calls: total.calls, proposals: total.proposals, won: total.won, wonText: dollars(total.wonMinor) },
    lines: lines.map((line) => ({ key: line.key, label: line.label, leads: line.leads, calls: share(line.calls, line.leads), proposals: share(line.proposals, line.leads), won: share(line.won, line.leads), wonText: dollars(line.wonMinor) })),
    unknown: lines.find((line) => line.key === "source:website")?.leads ?? 0,
  });
}
