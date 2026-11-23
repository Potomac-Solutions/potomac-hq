// Whether a client's website is open to everyone. Before it launches it can
// say "coming soon", and later it can be closed for maintenance. Either
// way it can open by itself at a set time, and someone holding its preview
// link sees the real site meanwhile.
//
// The site decides what to show from the `launch` block of its content
// file. This is a curtain, not a lock: a static site's pages are public
// files, so someone who goes looking can find what is behind it.
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type LaunchMode = "live" | "coming-soon" | "maintenance";
export const LAUNCH_MODES: readonly LaunchMode[] = ["live", "coming-soon", "maintenance"];

export type Launch = {
  readonly mode: LaunchMode;
  /** The instant the site opens by itself, when it is not live. Null: it stays as it is until someone opens it. */
  readonly opensAt: string | null;
  /** A line of the client's own on the holding page. */
  readonly message: string;
};

export const LIVE: Launch = { mode: "live", opensAt: null, message: "" };
export const MAX_MESSAGE = 200;

export type LaunchError = "mode-invalid" | "opens-invalid" | "opens-past" | "opens-time-missing" | "status-message-too-long";

export type LaunchInput = {
  readonly mode: string;
  /** A calendar day and a time of day, in the business's time zone. Both empty for no opening time. */
  readonly opensOn?: string | null;
  readonly opensTime?: string | null;
  readonly message?: string | null;
};

/**
 * A status someone chose. An opening time is a day and a time in
 * `timeZone`, and must still be ahead: a time already gone would open the
 * site at once, which is what "live" is for.
 */
export function launchFrom(input: LaunchInput, timeZone: string, now: string): Result<Launch, LaunchError> {
  const mode = LAUNCH_MODES.find((one) => one === input.mode);
  if (!mode) return err("mode-invalid");
  const message = (input.message ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (message.length > MAX_MESSAGE) return err("status-message-too-long");
  if (mode === "live") return ok(LIVE);
  const day = (input.opensOn ?? "").trim();
  const time = (input.opensTime ?? "").trim();
  if (!day && !time) return ok({ mode, opensAt: null, message });
  if (!day) return err("opens-invalid");
  if (!time) return err("opens-time-missing");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return err("opens-invalid");
  let opensAt: string;
  try {
    // A time that doesn't exist on that day (clocks going forward) is refused, not moved.
    opensAt = Temporal.PlainDateTime.from(`${day}T${time}`, { overflow: "reject" }).toZonedDateTime(timeZone, { disambiguation: "reject" }).toInstant().toString();
  } catch {
    return err("opens-invalid");
  }
  if (Temporal.Instant.compare(opensAt, now) <= 0) return err("opens-past");
  return ok({ mode, opensAt, message });
}

/** True when visitors see the site: it is live, or its opening time has come. */
export function isOpen(launch: Launch, now: string): boolean {
  return launch.mode === "live" || (launch.opensAt !== null && Temporal.Instant.compare(launch.opensAt, now) <= 0);
}

/** The opening time as the day and time someone would type, in `timeZone`. Empty when there is none. */
export function opensFields(launch: Launch, timeZone: string): { readonly opensOn: string; readonly opensTime: string } {
  if (!launch.opensAt) return { opensOn: "", opensTime: "" };
  const local = Temporal.Instant.from(launch.opensAt).toZonedDateTimeISO(timeZone);
  return { opensOn: local.toPlainDate().toString(), opensTime: local.toPlainTime().toString({ smallestUnit: "minute" }) };
}

/** "Friday, January 1, 2027 at 12:00 AM", in `timeZone`. */
export function opensText(opensAt: string, timeZone: string): string {
  const local = Temporal.Instant.from(opensAt).toZonedDateTimeISO(timeZone);
  const day = local.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const time = local.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}

/** What the status is, in a sentence, as of `now`. */
export function describeLaunch(launch: Launch, timeZone: string, now: string): string {
  if (launch.mode === "live") return "Open to everyone.";
  const what = launch.mode === "coming-soon" ? "“Coming soon”" : "“Closed for maintenance”";
  if (launch.opensAt && isOpen(launch, now)) return `Open to everyone. It opened by itself on ${opensText(launch.opensAt, timeZone)}.`;
  return launch.opensAt ? `Visitors see ${what}. It opens by itself on ${opensText(launch.opensAt, timeZone)}.` : `Visitors see ${what} until someone opens it.`;
}

// ── The site's own file ──────────────────────────────────────────────────

/** A preview key is 32 hex characters HQ made. Only its SHA-256 goes in the site's file. */
export const isPreviewKey = (text: string): boolean => /^[0-9a-f]{32}$/.test(text);

/**
 * The `launch` block of the site's content file. `previewKeyHash` lets the
 * site check a preview link without holding the key itself.
 */
export function launchBlock(launch: Launch, timeZone: string, previewKeyHash: string | null): Record<string, unknown> {
  if (launch.mode === "live") return { mode: "live" };
  return { mode: launch.mode, ...(launch.opensAt ? { opensAt: launch.opensAt } : {}), timeZone, ...(launch.message ? { message: launch.message } : {}), ...(previewKeyHash ? { previewKeyHash } : {}) };
}

/** The status in a content file someone may have changed by hand. Anything that can't be read is "live". */
export function readLaunch(json: string): Launch {
  try {
    const block = (JSON.parse(json) as { launch?: unknown }).launch;
    if (typeof block !== "object" || block === null) return LIVE;
    const { mode, opensAt, message } = block as Record<string, unknown>;
    const known = LAUNCH_MODES.find((one) => one === mode);
    if (!known || known === "live") return LIVE;
    let at: string | null = null;
    if (typeof opensAt === "string") at = Temporal.Instant.from(opensAt).toString();
    return { mode: known, opensAt: at, message: typeof message === "string" ? message.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE) : "" };
  } catch {
    return LIVE;
  }
}

/** The site's own address, for its preview link: https, a public name, no path beyond a slash. */
export function cleanSiteAddress(typed: string): Result<string, "address-invalid"> {
  const text = typed.trim();
  if (text === "") return ok("");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return err("address-invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".") || url.search || url.hash || text.length > 200) return err("address-invalid");
  return ok(`${url.origin}${url.pathname.replace(/\/+$/, "")}`);
}

/** The link that shows the real site to whoever holds it, while visitors see the holding page. */
export const previewLink = (siteUrl: string, previewKey: string): string => `${siteUrl}/?preview=${previewKey}`;
