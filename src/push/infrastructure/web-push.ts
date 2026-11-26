// Web Push, by hand (RFC 8291 message encryption, RFC 8292 VAPID), with
// node:crypto and fetch: no package. An alert is encrypted for one device's
// keys and posted to its push service, signed with HQ's VAPID key.
import { createECDH, createPrivateKey, createCipheriv, hkdfSync, randomBytes, sign } from "node:crypto";

export type VapidKeys = { readonly publicKey: string; readonly privateKey: string; readonly subject: string };
export type DeviceKeys = { readonly endpoint: string; readonly p256dh: string; readonly auth: string };
export type PushOutcome = "sent" | "gone" | "failed";

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const fromB64url = (text: string): Buffer => Buffer.from(text, "base64url");

/** A new VAPID key pair: the public key (65 bytes) and private key (32 bytes), base64url. */
export function vapidKeyPair(): { readonly publicKey: string; readonly privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

/** Reads HQ_VAPID_* from the environment: null when unset; throws when half set or wrong. */
export function vapidFrom(env: NodeJS.ProcessEnv): VapidKeys | null {
  const publicKey = (env["HQ_VAPID_PUBLIC_KEY"] ?? "").trim();
  const privateKey = (env["HQ_VAPID_PRIVATE_KEY"] ?? "").trim();
  const subject = (env["HQ_VAPID_SUBJECT"] ?? "").trim();
  if (!publicKey && !privateKey) return null;
  if (!publicKey || !privateKey) throw new Error("Set both HQ_VAPID_PUBLIC_KEY and HQ_VAPID_PRIVATE_KEY (npm run push:keygen makes them), or neither.");
  if (fromB64url(publicKey).length !== 65 || fromB64url(privateKey).length !== 32) throw new Error("HQ_VAPID_PUBLIC_KEY or HQ_VAPID_PRIVATE_KEY isn't a key npm run push:keygen made.");
  if (subject && !/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) throw new Error("HQ_VAPID_SUBJECT must be mailto:you@example.com or an https address.");
  return { publicKey, privateKey, subject: subject || "mailto:mikey@potomac.solutions" };
}

/** RFC 8291: the payload encrypted for one device, as the request body (aes128gcm, one record). */
export function encryptFor(device: Pick<DeviceKeys, "p256dh" | "auth">, payload: Uint8Array, salt: Uint8Array = randomBytes(16)): Buffer {
  const uaPublic = fromB64url(device.p256dh);
  const authSecret = fromB64url(device.auth);
  // A new key pair for every message.
  const ephemeral = createECDH("prime256v1");
  ephemeral.generateKeys();
  const asPublic = ephemeral.getPublicKey();
  const shared = ephemeral.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // The last (and only) record ends with a 2 delimiter and no padding.
  const sealed = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  Buffer.from(salt).copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, sealed]);
}

/** RFC 8292: the Authorization header for one push service. */
export function vapidHeader(keys: VapidKeys, endpoint: string, nowSeconds: number): string {
  const audience = new URL(endpoint).origin;
  const publicKey = fromB64url(keys.publicKey);
  const jwk = { kty: "EC", crv: "P-256", x: b64url(publicKey.subarray(1, 33)), y: b64url(publicKey.subarray(33, 65)), d: keys.privateKey };
  const key = createPrivateKey({ key: jwk, format: "jwk" });
  const part = (value: unknown) => b64url(Buffer.from(JSON.stringify(value)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: audience, exp: nowSeconds + 12 * 3600, sub: keys.subject })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64url(signature)}, k=${keys.publicKey}`;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: Uint8Array; signal: AbortSignal }) => Promise<{ status: number }>;

/** Sends one alert to one device. "gone" means the device unsubscribed: forget it. */
export function webPushSender(keys: VapidKeys, fetchFn: Fetch = fetch as unknown as Fetch, now: () => number = () => Math.floor(Date.now() / 1000)) {
  return async (device: DeviceKeys, alert: { readonly title: string; readonly body: string; readonly url: string; readonly tag?: string }): Promise<PushOutcome> => {
    try {
      const body = encryptFor(device, new TextEncoder().encode(JSON.stringify(alert)));
      const response = await fetchFn(device.endpoint, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "content-encoding": "aes128gcm", ttl: String(12 * 3600), urgency: "normal", authorization: vapidHeader(keys, device.endpoint, now()) },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404 || response.status === 410) return "gone";
      return response.status >= 200 && response.status < 300 ? "sent" : "failed";
    } catch {
      return "failed";
    }
  };
}
