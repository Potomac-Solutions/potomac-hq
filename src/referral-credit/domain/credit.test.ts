import assert from "node:assert/strict";
import { test } from "node:test";
import { codeFor, creditToApply, referrerName } from "./credit.ts";

test("a credit covers what it can, but never the invoice's last dollar", () => {
  assert.equal(creditToApply(2500, 5000), 2500);
  assert.equal(creditToApply(7500, 5000), 4900);
  assert.equal(creditToApply(2500, 100), 0);
  assert.equal(creditToApply(0, 5000), 0);
});

test("a person who referred them is typed in, briefly", () => {
  assert.deepEqual(referrerName("  Dale at the  feed store "), { ok: true, value: "Dale at the feed store" });
  assert.deepEqual(referrerName(""), { ok: true, value: null });
  assert.deepEqual(referrerName("x".repeat(101)), { ok: false, error: "name-too-long" });
});

test("a client's link code comes from their name", () => {
  assert.equal(codeFor("Moats Hardware"), "moats-hardware");
  assert.equal(codeFor("Café Été & Co."), "cafe-ete-co");
  assert.equal(codeFor("!!"), "client");
  assert.equal(codeFor("A very long business name that goes on and on").length <= 28, true);
});
