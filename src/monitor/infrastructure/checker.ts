// Checking a site from HQ's server: its address must resolve only to public
// addresses (so a client's domain cannot be pointed at Railway's insides),
// then a GET within ten seconds, and its certificate's expiry for https.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { connect } from "node:tls";
import type { SiteChecker } from "../application/ports.ts";

/** Whether an address is private, loopback, link-local or otherwise not the public internet. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
  return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
}

function certExpiry(host: string): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
      const validTo = socket.getPeerCertificate()?.valid_to;
      socket.end();
      try {
        resolve(validTo ? Temporal.Instant.fromEpochMilliseconds(Date.parse(validTo)).toZonedDateTimeISO("UTC").toPlainDate().toString() : null);
      } catch {
        resolve(null);
      }
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

export function httpSiteChecker(deps: { readonly fetch?: typeof fetch; readonly resolve?: (host: string) => Promise<readonly string[]>; readonly cert?: (host: string) => Promise<string | null> } = {}): SiteChecker {
  const send = deps.fetch ?? fetch;
  const resolve = deps.resolve ?? (async (host: string) => (await lookup(host, { all: true })).map((one) => one.address));
  const cert = deps.cert ?? certExpiry;
  return async (url) => {
    const { hostname, protocol } = new URL(url);
    let addresses: readonly string[];
    try {
      addresses = await resolve(hostname);
    } catch {
      return { ok: false, detail: "The name doesn’t resolve", certExpiresOn: null };
    }
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) return { ok: false, detail: "Not a public address", certExpiresOn: null };
    const started = performance.now();
    let detail: string;
    let up = false;
    try {
      const response = await send(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "user-agent": "Potomac HQ site check" } });
      await response.body?.cancel();
      up = response.status < 400;
      detail = up ? `${response.status} in ${Math.round(performance.now() - started)} ms` : `HTTP ${response.status}`;
    } catch (error) {
      detail = error instanceof Error && error.name === "TimeoutError" ? "Timed out after 10 seconds" : "Couldn’t connect";
    }
    return { ok: up, detail, certExpiresOn: protocol === "https:" ? await cert(hostname) : null };
  };
}
