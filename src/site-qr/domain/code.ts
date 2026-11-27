// QR codes a client prints on business cards and flyers (decision 0023). A
// code is an address on the client's own site, `https://site/page?ref=code`,
// so scanning it never passes through HQ: the card keeps working when HQ is
// down, or after the client moves hosts. A small script on their site tells
// HQ about scans and the taps that follow, and HQ counts them.
import type { Id } from "../../shared/domain/id.ts";
import { requiredText } from "../../shared/domain/fields.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type SiteQrCode = {
  readonly id: Id;
  readonly organizationId: Id;
  /** Lower-case letters, digits and hyphens. Printed, so it never changes. */
  readonly code: string;
  /** What it's printed on: "Business cards, spring 2027". */
  readonly label: string;
  /** The site's origin, like https://betterdaystowing.com. Printed, so it never changes. */
  readonly site: string;
  /** The page on the site, starting with a slash. Printed, so it never changes. */
  readonly page: string;
  readonly retired: boolean;
};

/** The name the code travels under in the address. */
export const REF_PARAM = "ref";
/** Codes a client may keep. */
export const MAX_CODES = 100;

export type CodeError = "label-missing" | "label-too-long" | "code-invalid" | "page-invalid" | "site-invalid";

/** A code someone typed, or null when it can't be one. */
export function cleanCode(typed: string): string | null {
  const code = typed.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])$/.test(code) ? code : null;
}

/** A code nobody chose: six letters and digits that are hard to misread. */
export function codeFrom(random: Uint8Array): string {
  const letters = "abcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += letters[(random[i] ?? 0) % letters.length];
  return code;
}

/**
 * A page on the site, as typed: "/", "services", "/towing#call", or the
 * whole address on the chosen site. Any `ref` in it is dropped, since the
 * code's own goes there. Null when it isn't a page.
 */
export function cleanPage(typed: string, site: string): string | null {
  let text = typed.trim();
  if (text === "") return "/";
  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (sameHost(url.hostname, new URL(site).hostname) === false) return null;
    text = url.pathname + url.search + url.hash;
  }
  if (!text.startsWith("/")) text = `/${text}`;
  if (text.startsWith("//") || text.length > 120 || !/^\/[A-Za-z0-9\-._~/%?=&#+]*$/.test(text)) return null;
  const [before = "", hash] = text.split("#", 2);
  const [path = "/", query = ""] = before.split("?", 2);
  const params = new URLSearchParams(query);
  params.delete(REF_PARAM);
  const rest = params.toString();
  return `${path}${rest ? `?${rest}` : ""}${hash === undefined || hash === "" ? "" : `#${hash}`}`;
}

/** A host name without "www.", lower-case. */
export const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, "");
const sameHost = (a: string, b: string): boolean => bareHost(a) === bareHost(b);

/**
 * A client's site addresses (as HQ has them, any page on them) made into
 * the origins a code may point at: https only, each host once.
 */
export function originsOf(addresses: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const address of addresses) {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    if (url.username || url.password || !url.hostname.includes(".")) continue;
    const key = bareHost(url.hostname);
    if (!seen.has(key)) seen.set(key, `https://${url.host.toLowerCase()}`);
  }
  return [...seen.values()];
}

export function newCode(ids: { readonly id: Id; readonly organizationId: Id }, input: { readonly code: string; readonly label: string; readonly site: string; readonly page: string }, sites: readonly string[]): Result<SiteQrCode, CodeError> {
  const label = requiredText(input.label, 120);
  if (!label.ok) return err(label.error === "missing" ? "label-missing" : "label-too-long");
  const code = cleanCode(input.code);
  if (code === null) return err("code-invalid");
  const site = sites.length === 1 && input.site.trim() === "" ? sites[0] : sites.find((one) => one === input.site.trim());
  if (!site) return err("site-invalid");
  const page = cleanPage(input.page, site);
  if (page === null) return err("page-invalid");
  return ok({ ...ids, code, label: label.value, site, page, retired: false });
}

/** The address the QR code holds: the page, with the code as `ref`, before any #part. */
export function addressOf(code: Pick<SiteQrCode, "site" | "page" | "code">): string {
  const [before = "", hash] = code.page.split("#", 2);
  const [path = "/", query = ""] = before.split("?", 2);
  const params = new URLSearchParams(query);
  params.set(REF_PARAM, code.code);
  return `${code.site}${path}?${params.toString()}${hash === undefined ? "" : `#${hash}`}`;
}

/** What a script on the site may report. */
export const EVENT_KINDS = ["scan", "call", "text", "email"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const isEventKind = (kind: string): kind is EventKind => (EVENT_KINDS as readonly string[]).includes(kind);

/** How long a report may wait in a visitor's browser while HQ couldn't be reached. */
export const LATE_DAYS = 7;

/**
 * When a report happened: the time the browser says, when it's within the
 * last week and not ahead of now, since a report kept while HQ was down
 * arrives later. Otherwise now.
 */
export function whenReported(typedMs: string, now: string): string {
  const said = Number(typedMs);
  const nowMs = Temporal.Instant.from(now).epochMilliseconds;
  if (!Number.isSafeInteger(said) || said > nowMs || said < nowMs - LATE_DAYS * 24 * 3600 * 1000) return now;
  return Temporal.Instant.fromEpochMilliseconds(said).toString();
}

/**
 * True for a program, not a person: link previews in chat apps, search
 * crawlers, uptime checks. Their reports aren't counted.
 */
export function isAutomated(userAgent: string): boolean {
  return userAgent.trim() === "" || /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|curl\/|wget\/|python-|headless|monitor|pingdom|uptime/i.test(userAgent);
}

/**
 * The script that goes on the client's site, once, in its shared layout.
 * Plain JavaScript with nothing to load. `hook` is HQ's address for reports.
 * The site works the same with or without it, and whether HQ answers.
 */
export function trackingScript(hook: string): string {
  return `<!-- Potomac Solutions: counts scans of your QR codes. Your site works the same without it. -->
<script>
(function () {
  var HOOK = ${JSON.stringify(hook)}, CODE = "potomac-qr", VISIT = "potomac-qr-visit", WAIT = "potomac-qr-wait", DAY = 864e5;
  function load(key, store) { try { return JSON.parse(store.getItem(key) || "null"); } catch (e) { return null; } }
  function keep(key, value, store) { try { store.setItem(key, JSON.stringify(value)); } catch (e) {} }
  function later(report) {
    var wait = (load(WAIT, localStorage) || []).filter(function (one) { return one.t > Date.now() - 7 * DAY; });
    if (wait.length < 20) wait.push(report);
    keep(WAIT, wait, localStorage);
  }
  function send(report) {
    if (!window.fetch) return;
    fetch(HOOK, { method: "POST", body: new URLSearchParams({ code: report.code, kind: report.kind, t: String(report.t), v: report.v || "" }), keepalive: true, credentials: "omit" })
      .then(function (answer) { if (answer.status >= 500) later(report); })
      .catch(function () { later(report); });
  }
  var waiting = load(WAIT, localStorage) || [];
  keep(WAIT, [], localStorage);
  waiting.forEach(send);
  var visit = load(VISIT, sessionStorage);
  if (!visit) { visit = Math.random().toString(36).slice(2, 12); keep(VISIT, visit, sessionStorage); }
  var url = new URL(location.href), code = url.searchParams.get("ref");
  if (code && /^[a-z0-9-]{2,32}$/i.test(code)) {
    keep(CODE, code.toLowerCase(), sessionStorage);
    send({ code: code.toLowerCase(), kind: "scan", t: Date.now(), v: visit });
    url.searchParams.delete("ref");
    try { history.replaceState(history.state, "", url.pathname + url.search + url.hash); } catch (e) {}
  }
  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null, saved = load(CODE, sessionStorage);
    if (!link || !saved) return;
    var kind = /^tel:/i.test(link.href) ? "call" : /^sms:/i.test(link.href) ? "text" : /^mailto:/i.test(link.href) ? "email" : "";
    if (kind) send({ code: saved, kind: kind, t: Date.now(), v: visit });
  }, true);
})();
</script>`;
}

/** "Last scanned 3 days ago"-style counts, for one code. */
export type CodeCounts = {
  readonly scans: number;
  readonly recentScans: number;
  readonly calls: number;
  readonly texts: number;
  readonly emails: number;
  readonly lastScanAt: string | null;
};
