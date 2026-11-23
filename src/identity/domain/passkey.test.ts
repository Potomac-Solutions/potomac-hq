import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAssertion, checkClientData, checkRegistration, counterWentBack, fromBase64Url, passkeyLabel, readAuthenticatorData, readCbor, toBase64Url } from "./passkey.ts";

const text = (value: string) => new TextEncoder().encode(value);
const concat = (...parts: (Uint8Array | number[])[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
const rpIdHash = new Uint8Array(32).fill(7);
const x = new Uint8Array(32).fill(1);
const y = new Uint8Array(32).fill(2);
// {1: 2, 3: -7, -1: 1, -2: x, -3: y}: an ES256 public key in COSE.
const cose = concat([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20], x, [0x22, 0x58, 0x20], y);
const credentialId = new Uint8Array(20).fill(9);
const authData = (flags: number, count: number, withKey: boolean) => concat(rpIdHash, [flags, 0, 0, 0, count], withKey ? concat(new Uint8Array(16), [0, credentialId.length], credentialId, cose) : []);
// {"fmt": "none", "attStmt": {}, "authData": <bytes>}
const attestation = (data: Uint8Array) => concat([0xa3, 0x63], text("fmt"), [0x64], text("none"), [0x67], text("attStmt"), [0xa0, 0x68], text("authData"), [0x58, data.length], data);
const clientData = (type: string, challenge: string, origin: string) => text(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
const expect = { challenge: "abc123", origins: ["https://hq.example"], rpIdHash };

test("base64url goes both ways, and refuses what isn't", () => {
  for (const bytes of [new Uint8Array([]), new Uint8Array([255]), new Uint8Array([1, 2]), new Uint8Array([250, 251, 252, 253])]) assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
  assert.equal(toBase64Url(new Uint8Array([251, 255])), "-_8");
  assert.equal(fromBase64Url("a+b/"), null);
});

test("CBOR: the small part an authenticator sends, and nothing cut short", () => {
  assert.deepEqual(readCbor(new Uint8Array([0x18, 0x64])).value, 100);
  assert.deepEqual(readCbor(new Uint8Array([0x26])).value, -7);
  assert.deepEqual(readCbor(new Uint8Array([0x82, 0x01, 0x61, 0x61])).value, [1, "a"]);
  assert.throws(() => readCbor(new Uint8Array([0x58, 0x20, 1, 2])));
});

test("a new passkey: its id and ES256 key are read from the attestation", () => {
  const made = checkRegistration({ clientDataJson: clientData("webauthn.create", "abc123", "https://hq.example"), attestationObject: attestation(authData(0x45, 0, true)) }, expect);
  assert.ok(made.ok);
  assert.equal(made.value.credentialId, toBase64Url(credentialId));
  assert.deepEqual(made.value.key, { algorithm: -7, jwk: { kty: "EC", crv: "P-256", x: toBase64Url(x), y: toBase64Url(y) } });
});

test("a passkey is refused for the wrong challenge, address, site, kind, or with nobody present", () => {
  const good = attestation(authData(0x45, 0, true));
  const register = (client: Uint8Array, object = good, want = expect) => checkRegistration({ clientDataJson: client, attestationObject: object }, want);
  assert.deepEqual(register(clientData("webauthn.create", "other", "https://hq.example")), { ok: false, error: "passkey-challenge" });
  assert.deepEqual(register(clientData("webauthn.create", "abc123", "https://evil.example")), { ok: false, error: "passkey-origin" });
  assert.deepEqual(register(clientData("webauthn.get", "abc123", "https://hq.example")), { ok: false, error: "passkey-wrong-kind" });
  assert.deepEqual(register(clientData("webauthn.create", "abc123", "https://hq.example"), good, { ...expect, rpIdHash: new Uint8Array(32) }), { ok: false, error: "passkey-site" });
  assert.deepEqual(register(clientData("webauthn.create", "abc123", "https://hq.example"), attestation(authData(0x40, 0, true))), { ok: false, error: "passkey-not-present" });
  assert.deepEqual(register(clientData("webauthn.create", "abc123", "https://hq.example"), attestation(authData(0x01, 0, false))), { ok: false, error: "passkey-key" });
  assert.deepEqual(register(text("not json")), { ok: false, error: "passkey-malformed" });
  assert.deepEqual(checkClientData(text(JSON.stringify({ type: "webauthn.get", challenge: "abc123", origin: "https://hq.example", crossOrigin: true })), { type: "webauthn.get", challenge: "abc123", origins: expect.origins }), { ok: false, error: "passkey-origin" });
});

test("a passkey used: the counter is read, and one that went back is a copy", () => {
  const used = checkAssertion({ clientDataJson: clientData("webauthn.get", "abc123", "https://hq.example"), authenticatorData: authData(0x05, 12, false) }, expect);
  assert.deepEqual(used, { ok: true, value: { signCount: 12 } });
  assert.equal(readAuthenticatorData(new Uint8Array(10)), null);
  assert.equal(counterWentBack(12, 13), false);
  assert.equal(counterWentBack(12, 12), true);
  assert.equal(counterWentBack(0, 0), false, "an authenticator that keeps no counter");
});

test("a passkey's name is trimmed, defaults to Passkey, and is at most 60 characters", () => {
  assert.equal(passkeyLabel("  My  laptop "), "My laptop");
  assert.equal(passkeyLabel(""), "Passkey");
  assert.equal(passkeyLabel("x".repeat(61)), null);
});
