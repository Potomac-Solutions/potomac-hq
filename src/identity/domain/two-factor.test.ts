import assert from "node:assert/strict";
import { test } from "node:test";
import { appLink, cleanCode, cleanRecoveryCode, groupSecret, showRecoveryCode } from "./two-factor.ts";

test("a code is six digits, however it is typed", () => {
  for (const typed of ["123456", " 123 456 ", "123-456"]) assert.equal(cleanCode(typed), "123456", typed);
  for (const typed of ["12345", "1234567", "12345a", ""]) assert.equal(cleanCode(typed), null, typed);
});

test("a recovery code is ten letters and digits that cannot be misread", () => {
  assert.equal(cleanRecoveryCode("abcde-fghjk"), "ABCDEFGHJK");
  assert.equal(cleanRecoveryCode(" ABCDE FGHJK "), "ABCDEFGHJK");
  assert.equal(cleanRecoveryCode("ABCDE-FGHJ1"), null, "no 1, 0 or O: they are easy to misread");
  assert.equal(cleanRecoveryCode("short"), null);
  assert.equal(showRecoveryCode("ABCDEFGHJK"), "ABCDE-FGHJK");
});

test("the secret is grouped for typing, and the app link names HQ and the person", () => {
  assert.equal(groupSecret("ABCDEFGHIJKL"), "ABCD EFGH IJKL");
  assert.equal(appLink("ABC234", "mikey@example.com"), "otpauth://totp/Potomac%20HQ%3Amikey%40example.com?secret=ABC234&issuer=Potomac%20HQ");
});
