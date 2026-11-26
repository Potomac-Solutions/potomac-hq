// Web Push's encryption checked by decrypting as a browser would, and its
// VAPID signature checked against the public key.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import { encryptFor, vapidFrom, vapidHeader, vapidKeyPair, webPushSender } from "./web-push.ts";

function browser() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") }, auth };
}

function decrypt(body: Buffer, ua: ReturnType<typeof browser>): string {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const sealed = body.subarray(21 + idlen);
  const shared = ua.ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync("sha256", shared, ua.auth, Buffer.concat([Buffer.from("WebPush: info\0"), ua.ecdh.getPublicKey(), asPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  assert.equal(plain.at(-1), 2, "one last record");
  return plain.subarray(0, -1).toString("utf8");
}

test("an alert is encrypted so only that device can read it (RFC 8291)", () => {
  const ua = browser();
  const body = encryptFor(ua.keys, new TextEncoder().encode('{"title":"Site down"}'));
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(decrypt(body, ua), '{"title":"Site down"}');
  assert.throws(() => decrypt(body, browser()), "another device can't");
});

test("the VAPID header is a JWT signed with HQ's key, for the push service's origin (RFC 8292)", () => {
  const pair = vapidKeyPair();
  const header = vapidHeader({ ...pair, subject: "mailto:mikey@potomac.solutions" }, "https://fcm.googleapis.com/fcm/send/abc", 1_000);
  const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header) ?? [];
  assert.equal(key, pair.publicKey);
  const [head, claims, signature] = (token ?? "").split(".");
  assert.deepEqual(JSON.parse(Buffer.from(claims ?? "", "base64url").toString()), { aud: "https://fcm.googleapis.com", exp: 1_000 + 43_200, sub: "mailto:mikey@potomac.solutions" });
  const raw = Buffer.from(pair.publicKey, "base64url");
  const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature ?? "", "base64url")));
});

test("keys from the environment: both or neither, and the right size", () => {
  assert.equal(vapidFrom({}), null);
  const pair = vapidKeyPair();
  assert.equal(vapidFrom({ HQ_VAPID_PUBLIC_KEY: pair.publicKey, HQ_VAPID_PRIVATE_KEY: pair.privateKey })?.subject, "mailto:mikey@potomac.solutions");
  assert.throws(() => vapidFrom({ HQ_VAPID_PUBLIC_KEY: pair.publicKey }), /both/);
  assert.throws(() => vapidFrom({ HQ_VAPID_PUBLIC_KEY: "abc", HQ_VAPID_PRIVATE_KEY: "def" }), /isn't a key/);
});

test("a device that's gone says so; a refused send fails", async () => {
  const pair = { ...vapidKeyPair(), subject: "mailto:a@b.co" };
  const ua = browser();
  const device = { endpoint: "https://push.example/x", ...ua.keys };
  const seen: Record<string, string>[] = [];
  const answering = (status: number) => async (_url: string, init: { headers: Record<string, string> }) => (seen.push(init.headers), { status });
  assert.equal(await webPushSender(pair, answering(201))(device, { title: "Hi", body: "", url: "/" }), "sent");
  assert.equal(seen[0]?.["content-encoding"], "aes128gcm");
  assert.equal(await webPushSender(pair, answering(410))(device, { title: "Hi", body: "", url: "/" }), "gone");
  assert.equal(await webPushSender(pair, answering(500))(device, { title: "Hi", body: "", url: "/" }), "failed");
});
