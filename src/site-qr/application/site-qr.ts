// QR codes a client prints, counted from their own site (decision 0023).
// A client makes them in the portal; Potomac's people make them on the
// client in HQ with `site-qr.manage`. A scan never passes through HQ: the
// script on the client's site reports it, and HQ counts it.
import { addressOf, bareHost, cleanCode, codeFrom, isAutomated, isEventKind, MAX_CODES, newCode, originsOf, trackingScript, whenReported, type CodeError, type SiteQrCode } from "../domain/code.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, requiredText, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { QrPictures, SiteQrStore } from "./ports.ts";

export type SiteQrDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly codes: SiteQrStore;
  readonly qr: QrPictures;
  /** Every address HQ has for a client's sites: website content, monitored sites, the free landing page. */
  readonly siteAddressesOf: (organizationId: Id) => readonly string[];
  /** The clients with a site at a host (no "www."). */
  readonly organizationsAt: (host: string) => readonly Id[];
  readonly clientName: (organizationId: Id) => string | null;
  readonly formatWhen: (instant: string) => string;
  readonly random: (length: number) => Uint8Array;
};

/** A client signed in to the portal, as the portal's session gives it. */
export type ClientPerson = { readonly clientUserId: Id; readonly organizationId: Id };

/**
 * Who is asking. A client's own codes come from their session and from
 * nothing they send; one of Potomac's people names the client.
 */
export type Who = { readonly kind: "client"; readonly session: ClientPerson | null } | { readonly kind: "staff"; readonly actorId: Id | null; readonly organizationId: Id };

type Refused = "forbidden" | "not-found";

/** The client a person may act for, or why not. Viewing needs less than changing. */
function clientFor(deps: SiteQrDeps, who: Who, change: boolean): Result<Id, Refused> {
  if (who.kind === "client") return who.session ? ok(who.session.organizationId) : err("not-found");
  if (who.actorId === null || !authorize(deps, who.actorId, change ? "site-qr.manage" : "client.view").ok) return err("forbidden");
  return deps.clientName(who.organizationId) === null ? err("not-found") : ok(who.organizationId);
}

/**
 * A code the person may act on. A client's own only: another client's codes
 * don't exist for them. One of Potomac's people may act on any client's.
 */
function codeFor(deps: SiteQrDeps, who: Who | Staff, id: Id, change: boolean): Result<SiteQrCode, Refused> {
  const code = deps.codes.get(id);
  const organizationId = clientFor(deps, who.kind === "staff" ? { ...who, organizationId: code?.organizationId ?? who.organizationId ?? ("" as Id) } : who, change);
  if (!organizationId.ok) return organizationId;
  return code && code.organizationId === organizationId.value ? ok(code) : err("not-found");
}

/** One of Potomac's people acting on a code, wherever it belongs. */
export type Staff = { readonly kind: "staff"; readonly actorId: Id | null; readonly organizationId?: undefined };

function note(deps: SiteQrDeps, who: Who | Staff, action: string, code: SiteQrCode, context: Record<string, string | number | boolean> = {}): void {
  recordActivity(deps, {
    actorId: who.kind === "staff" ? who.actorId : null,
    action,
    recordType: "site-qr",
    recordId: code.id,
    context: { organizationId: code.organizationId, code: code.code, label: code.label, ...(who.kind === "client" && who.session ? { clientUserId: who.session.clientUserId, by: "client" } : {}), ...context },
  });
}

export type NewCodeInput = { readonly code?: string | null; readonly label: string; readonly site?: string | null; readonly page?: string | null };
export type AddError = Refused | CodeError | "no-site" | "code-taken" | "too-many";

/** Makes a code. With no code given, HQ makes one up. */
export function addCode(deps: SiteQrDeps, who: Who, input: NewCodeInput): Result<SiteQrCode, AddError> {
  return deps.transact(() => {
    const organizationId = clientFor(deps, who, true);
    if (!organizationId.ok) return organizationId;
    const sites = originsOf(deps.siteAddressesOf(organizationId.value));
    if (sites.length === 0) return err("no-site");
    const existing = deps.codes.listFor(organizationId.value);
    if (existing.length >= MAX_CODES) return err("too-many");
    let code = (input.code ?? "").trim();
    if (code === "") {
      // Six characters from thirty-one: a clash is rare, and tried again.
      for (let tries = 0; tries < 20 && (code === "" || deps.codes.byCode(organizationId.value, code)); tries++) code = codeFrom(deps.random(6));
    }
    const made = newCode({ id: deps.newId(), organizationId: organizationId.value }, { code, label: input.label, site: input.site ?? "", page: input.page ?? "" }, sites);
    if (!made.ok) return made;
    if (deps.codes.byCode(organizationId.value, made.value.code)) return err("code-taken");
    deps.codes.insert(made.value, who.kind === "client" ? { clientUserId: (who.session as ClientPerson).clientUserId } : { userId: who.actorId as Id }, deps.clock());
    note(deps, who, "site-qr.created", made.value, { address: addressOf(made.value) });
    return ok(made.value);
  });
}

/** Changes what a code is called. Where it goes is printed, so it stays. */
export function renameCode(deps: SiteQrDeps, who: Who | Staff, id: Id, typed: string): Result<SiteQrCode, Refused | "label-missing" | "label-too-long"> {
  return deps.transact(() => {
    const found = codeFor(deps, who, id, true);
    if (!found.ok) return found;
    const label = requiredText(typed, 120);
    if (!label.ok) return err(label.error === "missing" ? "label-missing" : "label-too-long");
    const next = { ...found.value, label: label.value };
    deps.codes.save(next, deps.clock());
    note(deps, who, "site-qr.renamed", next, { from: found.value.label });
    return ok(next);
  });
}

/** Retires a code, or brings one back. A retired code still counts: printed cards may still be out there. */
export function setRetired(deps: SiteQrDeps, who: Who | Staff, id: Id, retired: boolean): Result<SiteQrCode, Refused | "unchanged"> {
  return deps.transact(() => {
    const found = codeFor(deps, who, id, true);
    if (!found.ok) return found;
    if (found.value.retired === retired) return err("unchanged");
    const next = { ...found.value, retired };
    deps.codes.save(next, deps.clock());
    note(deps, who, retired ? "site-qr.retired" : "site-qr.restored", next);
    return ok(next);
  });
}

/** Removes a code nobody has scanned. One that has been scanned can only be retired. */
export function removeCode(deps: SiteQrDeps, who: Who | Staff, id: Id): Result<SiteQrCode, Refused | "in-use"> {
  return deps.transact(() => {
    const found = codeFor(deps, who, id, true);
    if (!found.ok) return found;
    if (deps.codes.hasEvents(id)) return err("in-use");
    deps.codes.remove(id);
    note(deps, who, "site-qr.removed", found.value);
    return ok(found.value);
  });
}

/**
 * The script on a client's site reported a scan, or a tap after one. It is
 * counted only from a browser on that client's own site (the request's
 * Origin), for one of that client's codes. Anyone on the internet can send
 * one, so nothing in it is believed beyond that, and a refusal says nothing.
 *
 * No activity event: a scan is not a change anyone made, and a busy flyer
 * would bury the history. Its own row is the record.
 */
export function reportEvent(deps: SiteQrDeps, request: { readonly origin: string; readonly userAgent: string }, fields: { readonly code: string; readonly kind: string; readonly t: string }): boolean {
  if (isAutomated(request.userAgent) || !isEventKind(fields.kind)) return false;
  const code = cleanCode(fields.code);
  let host: string;
  try {
    const origin = new URL(request.origin);
    if (origin.protocol !== "https:" && origin.protocol !== "http:") return false;
    host = bareHost(origin.hostname);
  } catch {
    return false;
  }
  if (!code) return false;
  const kind = fields.kind;
  return deps.transact(() => {
    for (const organizationId of deps.organizationsAt(host)) {
      const found = deps.codes.byCode(organizationId, code);
      if (!found) continue;
      const now = deps.clock();
      deps.codes.addEvent(found.id, kind, whenReported(fields.t, now), now);
      return true;
    }
    return false;
  });
}

export type CodeLine = {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  /** The address the QR code holds. */
  readonly address: string;
  readonly scans: number;
  readonly recentScans: number;
  readonly calls: number;
  readonly texts: number;
  readonly emails: number;
  readonly lastScan: string;
  readonly retired: boolean;
  readonly removable: boolean;
  /** False when the address is too long for a QR code. */
  readonly scannable: boolean;
};

export type CodesView = {
  readonly organizationName: string;
  /** Where downloads and forms live: /portal/qr-codes, or /clients/<id>/qr-codes. */
  readonly base: string;
  readonly sites: readonly string[];
  readonly active: readonly CodeLine[];
  readonly retired: readonly CodeLine[];
  readonly canChange: boolean;
  readonly full: boolean;
  /** For Potomac's people only: the script to put on the site, and when HQ last heard from it. Empty for a client. */
  readonly script: string;
  readonly lastHeard: string;
  readonly totals: { readonly scans: number; readonly recentScans: number; readonly taps: number };
};

/** A client's codes with their counts. `hook` is HQ's address for the script's reports. */
export function codesView(deps: SiteQrDeps, who: Who, hook: string): Result<CodesView, Refused> {
  const organizationId = clientFor(deps, who, false);
  if (!organizationId.ok) return organizationId;
  const staff = who.kind === "staff";
  const canChange = clientFor(deps, who, true).ok;
  const monthAgo = Temporal.Instant.from(deps.clock()).subtract({ hours: 24 * 30 }).toString();
  const codes = deps.codes.listFor(organizationId.value);
  const lines = codes.map((code): CodeLine => {
    const counts = deps.codes.counts(code.id, monthAgo);
    const address = addressOf(code);
    return {
      id: code.id,
      code: code.code,
      label: code.label,
      address,
      scans: counts.scans,
      recentScans: counts.recentScans,
      calls: counts.calls,
      texts: counts.texts,
      emails: counts.emails,
      lastScan: counts.lastScanAt ? deps.formatWhen(counts.lastScanAt) : "",
      retired: code.retired,
      removable: !deps.codes.hasEvents(code.id),
      scannable: deps.qr.svg(address, code.label) !== null,
    };
  });
  const heard = staff ? deps.codes.lastHeard(organizationId.value) : null;
  return ok({
    organizationName: deps.clientName(organizationId.value) ?? "",
    base: staff ? `/clients/${organizationId.value}/qr-codes` : "/portal/qr-codes",
    sites: originsOf(deps.siteAddressesOf(organizationId.value)),
    active: lines.filter((line) => !line.retired),
    retired: lines.filter((line) => line.retired),
    canChange,
    full: codes.length >= MAX_CODES,
    script: staff ? trackingScript(hook) : "",
    lastHeard: heard ? deps.formatWhen(heard) : "",
    totals: { scans: lines.reduce((sum, one) => sum + one.scans, 0), recentScans: lines.reduce((sum, one) => sum + one.recentScans, 0), taps: lines.reduce((sum, one) => sum + one.calls + one.texts + one.emails, 0) },
  });
}

/** A code's QR picture, as an SVG or a PNG, to download. */
export function codePicture(deps: SiteQrDeps, who: Who | Staff, id: Id, format: "svg" | "png"): Result<{ readonly body: string | Uint8Array; readonly contentType: string; readonly fileName: string }, Refused> {
  const found = codeFor(deps, who, id, false);
  if (!found.ok) return found;
  const address = addressOf(found.value);
  const body = format === "svg" ? deps.qr.svg(address, `QR code for ${found.value.label}`) : deps.qr.png(address);
  if (body === null) return err("not-found");
  return ok({ body, contentType: format === "svg" ? "image/svg+xml" : "image/png", fileName: `qr-${found.value.code}.${format}` });
}
