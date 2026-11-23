// Reading an address someone typed (a calendar's private address, Timeful,
// Calendly) without letting it reach inside the server's own network.
//
// - https only, on the usual port, with no sign-in in the address.
// - The name is looked up here, and every address it resolves to must be a
//   public one. The connection is then made to the address that was checked,
//   so a name that changes its answer between the check and the connection
//   gains nothing.
// - Redirects are followed at most three times, each checked the same way.
// - Two megabytes and ten seconds at most.
import { lookup as dnsLookup } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";
import type { OutsideAnswer, OutsideError, OutsideFetch } from "../application/ports.ts";

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

/** Whether an IP address is on the public internet: not loopback, private, link-local, shared, multicast or reserved. */
export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (kind === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicAddress(mapped[1] as string);
    if (lower === "::" || lower === "::1" || lower.startsWith("::ffff:")) return false;
    // Unique local (fc00::/7), link-local (fe80::/10), multicast (ff00::/8), and the 64:ff9b::/96 gateway to IPv4.
    if (/^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith("ff") || lower.startsWith("64:ff9b:")) return false;
    return true;
  }
  return false;
}

type Lookup = (hostname: string, options: object, callback: (error: Error | null, address?: unknown, family?: number) => void) => void;

/** A DNS lookup that answers only with public addresses. */
const publicLookup: Lookup = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, found) => {
    if (error) return callback(error);
    const addresses = found as unknown as { address: string; family: number }[];
    if (addresses.length === 0 || !addresses.every((one) => isPublicAddress(one.address))) return callback(Object.assign(new Error("private address"), { code: "EPRIVATE" }));
    if ((options as { all?: boolean }).all) return callback(null, addresses);
    const first = addresses[0] as { address: string; family: number };
    callback(null, first.address, first.family);
  });
};

function once(url: URL, headers: Readonly<Record<string, string>>): Promise<{ status: number; location: string | null; text: string } | OutsideError> {
  return new Promise((resolve) => {
    const req = request(url, { method: "GET", headers: { accept: "text/calendar, application/json;q=0.9, */*;q=0.1", "user-agent": "PotomacHQ/1 (availability import)", ...headers }, lookup: publicLookup as never, timeout: TIMEOUT_MS, signal: AbortSignal.timeout(TIMEOUT_MS) }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          req.destroy();
          resolve("too-large");
        } else chunks.push(chunk);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, location: typeof res.headers.location === "string" ? res.headers.location : null, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", () => resolve("unreachable"));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", (error) => resolve((error as { code?: string }).code === "EPRIVATE" ? "address-private" : "unreachable"));
    req.end();
  });
}

function check(text: string): URL | OutsideError {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "address-invalid";
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port !== "" && url.port !== "443")) return "address-invalid";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // An address written as numbers is never looked up, so it is checked here.
  if (isIP(host) !== 0 && !isPublicAddress(host)) return "address-private";
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return "address-private";
  return url;
}

export const outsideFetch: OutsideFetch = async (address, headers = {}) => {
  let next = address;
  for (let hop = 0; hop < 4; hop += 1) {
    const url = check(next);
    if (typeof url === "string") return { ok: false, error: url };
    const answer = await once(url, hop === 0 ? headers : withoutSecrets(headers, new URL(address), url));
    if (typeof answer === "string") return { ok: false, error: answer };
    if (answer.status >= 300 && answer.status < 400 && answer.location) {
      next = new URL(answer.location, url).toString();
      continue;
    }
    return { ok: true, value: { status: answer.status, text: answer.text } satisfies OutsideAnswer };
  }
  return { ok: false, error: "unreachable" };
};

/** A token is only for the site it was sent to: a redirect elsewhere doesn't get it. */
function withoutSecrets(headers: Readonly<Record<string, string>>, first: URL, now: URL): Readonly<Record<string, string>> {
  if (first.host === now.host) return headers;
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== "authorization"));
}
