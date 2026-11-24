// Signing and sending webhook deliveries.
//
// The secret for a webhook is HMAC-SHA256 of its id and salt under HQ's own
// key, so it's never stored: shown once when it's made, and worked out again
// for each delivery. Changing HQ's key changes every webhook's secret.
//
// Sending is one POST to an https address on the usual port. The name is
// looked up here and every address it gives must be public; the connection
// goes to the address that was checked. Redirects are not followed. Ten
// seconds at most, and only the start of the answer is read.
import { createHmac, randomBytes } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";
import { isPublicAddress } from "../../booking/adapters.ts";
import type { HookSend, WebhookSigner } from "../application/webhooks.ts";

export function webhookSigner(key: string): WebhookSigner {
  return {
    newSalt: () => randomBytes(16).toString("base64url"),
    secretFor: (webhook) => createHmac("sha256", key).update(`potomac-hq webhook ${webhook.id} ${webhook.salt}`).digest("base64url"),
    sign: (secret, body) => createHmac("sha256", secret).update(body).digest("hex"),
  };
}

const TIMEOUT_MS = 10_000;
const ANSWER_BYTES = 2048;

type Lookup = (hostname: string, options: object, callback: (error: Error | null, address?: unknown, family?: number) => void) => void;
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

export const httpsHookSend: HookSend = (address, body, headers) =>
  new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return resolve({ error: "Not a web address" });
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || (url.port !== "" && url.port !== "443")) return resolve({ error: "Only https on the usual port" });
    if (isIP(host) !== 0 && !isPublicAddress(host)) return resolve({ error: "That address is inside a network" });
    const bytes = Buffer.from(body, "utf8");
    const req = request(url, { method: "POST", headers: { ...headers, "content-length": String(bytes.length) }, lookup: publicLookup as never, timeout: TIMEOUT_MS, signal: AbortSignal.timeout(TIMEOUT_MS) }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        if (size < ANSWER_BYTES) chunks.push(chunk);
        size += chunk.length;
        if (size > ANSWER_BYTES) res.destroy();
      });
      const done = () => resolve({ status: res.statusCode ?? 0, answer: Buffer.concat(chunks).toString("utf8").slice(0, ANSWER_BYTES) });
      res.on("end", done);
      res.on("close", done);
      res.on("error", done);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", (error) => resolve({ error: (error as { code?: string }).code === "EPRIVATE" ? "That address is inside a network" : `No answer (${(error as { code?: string }).code ?? "error"})` }));
    req.end(bytes);
  });
