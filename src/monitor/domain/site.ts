// Site monitoring: HQ checks each client website every few minutes. A site
// is down after two failed checks in a row, so one slow answer is not an
// alarm, and up again after one good one. Its certificate is watched too.
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type SiteState = "unknown" | "up" | "down";
/** Failed checks in a row before a site counts as down. */
export const DOWN_AFTER = 2;
/** Days before a certificate runs out that it is flagged. */
export const CERT_WARN_DAYS = 14;

export type Site = {
  readonly id: Id;
  readonly organizationId: Id;
  /** Always https:// or http://, with a host and no credentials. */
  readonly url: string;
  readonly active: boolean;
  readonly state: SiteState;
  readonly failures: number;
  readonly downSince: string | null;
  readonly lastCheckedAt: string | null;
  /** "200 in 312 ms", or why it failed: "Timed out", "HTTP 503". */
  readonly lastResult: string;
  readonly certExpiresOn: string | null;
  /** The certificate expiry already warned about, so it is warned once. */
  readonly certWarnedFor: string | null;
};

export type CheckResult = { readonly ok: boolean; readonly detail: string; readonly certExpiresOn: string | null };

/** What changed, for alerts. */
export type Change = { readonly kind: "down"; readonly reason: string } | { readonly kind: "up"; readonly downSince: string } | { readonly kind: "cert"; readonly expiresOn: string };

/**
 * A site address someone typed, made safe to check from HQ's server: http or
 * https only, a real public host name, no passwords in it, no odd ports.
 * Addresses inside Railway's network or the server itself are refused.
 */
export function cleanSiteUrl(typed: string): Result<string, "url-invalid" | "url-not-public"> {
  let text = typed.trim();
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return err("url-invalid");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || text.length > 300) return err("url-invalid");
  if (url.port && url.port !== "80" && url.port !== "443") return err("url-invalid");
  const host = url.hostname.toLowerCase();
  // An IP address, localhost, or a name that only means something inside a private network.
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[") || !host.includes(".") || /(^|\.)(localhost|local|internal|localdomain|home|lan|railway\.internal)$/.test(host)) return err("url-not-public");
  url.hash = "";
  return ok(url.toString());
}

/** The site after a check, and what changed. */
export function afterCheck(site: Site, result: CheckResult, now: string, today: string): { readonly site: Site; readonly changes: readonly Change[] } {
  const changes: Change[] = [];
  let next: Site = { ...site, lastCheckedAt: now, lastResult: result.detail, certExpiresOn: result.certExpiresOn ?? site.certExpiresOn };
  if (result.ok) {
    if (site.state === "down" && site.downSince) changes.push({ kind: "up", downSince: site.downSince });
    next = { ...next, state: "up", failures: 0, downSince: null };
  } else {
    const failures = site.failures + 1;
    if (failures >= DOWN_AFTER && site.state !== "down") {
      next = { ...next, state: "down", failures, downSince: now };
      changes.push({ kind: "down", reason: result.detail });
    } else next = { ...next, failures };
  }
  const expires = next.certExpiresOn;
  if (expires && next.certWarnedFor !== expires && Temporal.PlainDate.from(today).until(expires).days <= CERT_WARN_DAYS) {
    changes.push({ kind: "cert", expiresOn: expires });
    next = { ...next, certWarnedFor: expires };
  }
  return { site: next, changes };
}

/** "3 h 12 min", "2 days 4 h": how long between two instants, roughly. */
export function lasted(from: string, to: string): string {
  const minutes = Math.max(1, Math.round(Temporal.Instant.from(to).since(from).total("minutes")));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} days ${hours % 24} h`;
}

/** The share of a window a site was up, from its outages: "99.95%". */
export function uptime(outages: readonly { readonly start: string; readonly end: string | null }[], from: string, to: string): string {
  const total = Temporal.Instant.from(to).epochMilliseconds - Temporal.Instant.from(from).epochMilliseconds;
  let down = 0;
  for (const outage of outages) {
    const start = Math.max(Temporal.Instant.from(outage.start).epochMilliseconds, Temporal.Instant.from(from).epochMilliseconds);
    const end = Math.min(Temporal.Instant.from(outage.end ?? to).epochMilliseconds, Temporal.Instant.from(to).epochMilliseconds);
    if (end > start) down += end - start;
  }
  const share = total <= 0 ? 100 : 100 - (down / total) * 100;
  return `${share >= 99.995 ? "100" : share.toFixed(2)}%`;
}
