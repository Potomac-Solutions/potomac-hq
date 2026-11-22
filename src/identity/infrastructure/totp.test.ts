import assert from "node:assert/strict";
import { test } from "node:test";
import { base32, codeAt, fromBase32, sessionKeyOf, stepOf, totpCrypto } from "./totp.ts";

// RFC 6238, appendix B: the SHA1 secret is the ASCII "12345678901234567890".
const RFC_SECRET = base32(new TextEncoder().encode("12345678901234567890"));

test("codes match the RFC 6238 test vectors, to six digits", () => {
  for (const [seconds, eight] of [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]] as const) {
    assert.equal(codeAt(RFC_SECRET, stepOf(seconds * 1000)), eight.slice(2), String(seconds));
  }
});

test("base32 round-trips, and a new secret is 32 letters", () => {
  assert.equal(RFC_SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(fromBase32(RFC_SECRET).toString(), "12345678901234567890");
  assert.match(totpCrypto.newSecret(), /^[A-Z2-7]{32}$/);
  assert.notEqual(totpCrypto.newSecret(), totpCrypto.newSecret());
});

test("a code is accepted for the step before and after, and not further", () => {
  const at = 1_700_000_000_000;
  const step = stepOf(at);
  assert.equal(totpCrypto.verify(RFC_SECRET, codeAt(RFC_SECRET, step), at), step);
  assert.equal(totpCrypto.verify(RFC_SECRET, codeAt(RFC_SECRET, step - 1), at), step - 1);
  assert.equal(totpCrypto.verify(RFC_SECRET, codeAt(RFC_SECRET, step + 1), at), step + 1);
  assert.equal(totpCrypto.verify(RFC_SECRET, codeAt(RFC_SECRET, step - 2), at), null);
  assert.equal(totpCrypto.verify(RFC_SECRET, "000000", at) === null || codeAt(RFC_SECRET, step) === "000000", true);
});

test("recovery codes avoid letters that are easy to misread, and the session key matches the kit's", () => {
  for (let n = 0; n < 50; n++) assert.match(totpCrypto.newRecoveryCode(), /^[A-HJ-NP-Z2-9]{10}$/);
  assert.equal(sessionKeyOf("a=1; hq_session=abc; b=2", "hq_session"), totpCrypto.hash("abc"));
  assert.equal(sessionKeyOf("a=1", "hq_session"), null);
});
