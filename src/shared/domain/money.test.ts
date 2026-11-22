import assert from "node:assert/strict";
import { test } from "node:test";
import { addMoney, money, sameMoney, type Money } from "./money.ts";

function usd(minor: number): Money {
  const result = money(minor, "USD");
  assert.ok(result.ok);
  return result.value;
}

test("money is whole minor units in a known currency", () => {
  assert.deepEqual(money(7500, "USD"), { ok: true, value: { minor: 7500, currency: "USD" } });
  assert.deepEqual(money(0, "USD"), { ok: true, value: { minor: 0, currency: "USD" } });
});

test("fractions of a cent are refused", () => {
  assert.deepEqual(money(75.5, "USD"), { ok: false, error: "not-whole-minor-units" });
  assert.deepEqual(money(Number.NaN, "USD"), { ok: false, error: "not-whole-minor-units" });
  assert.deepEqual(money(Number.POSITIVE_INFINITY, "USD"), { ok: false, error: "not-whole-minor-units" });
  assert.deepEqual(money(2 ** 53, "USD"), { ok: false, error: "not-whole-minor-units" });
});

test("an unknown currency is refused", () => {
  assert.deepEqual(money(100, "usd"), { ok: false, error: "unknown-currency" });
  assert.deepEqual(money(100, "EUR"), { ok: false, error: "unknown-currency" });
});

test("adding keeps cents exact", () => {
  // 0.1 + 0.2 is not 0.3 in floating point. 10 + 20 cents is 30 cents.
  assert.deepEqual(addMoney(usd(10), usd(20)), { ok: true, value: usd(30) });
});

test("adding past the safe range is refused, not rounded", () => {
  assert.deepEqual(addMoney(usd(Number.MAX_SAFE_INTEGER), usd(1)), { ok: false, error: "not-whole-minor-units" });
});

test("sameMoney compares amount and currency", () => {
  assert.equal(sameMoney(usd(500), usd(500)), true);
  assert.equal(sameMoney(usd(500), usd(501)), false);
});

import { formatMoney, parseAmount } from "./money.ts";

test("amounts are read as people type them", () => {
  const cases: [string, number][] = [["1250", 125000], ["1,250.00", 125000], ["$75", 7500], ["$ 75.5", 7550], ["0", 0], ["0.05", 5], ["1,000,000", 100000000]];
  for (const [text, minor] of cases) assert.deepEqual(parseAmount(text, "USD"), { ok: true, value: { minor, currency: "USD" } }, text);
});

test("anything else is not an amount", () => {
  for (const text of ["", "abc", "-5", "1.234", "12,50", "1,2345", "$", "1e3", "١٢"]) {
    assert.deepEqual(parseAmount(text, "USD"), { ok: false, error: "not-an-amount" }, text);
  }
});

test("money is shown with a dollar sign, commas and cents", () => {
  assert.equal(formatMoney(usd(125000)), "$1,250.00");
  assert.equal(formatMoney(usd(5)), "$0.05");
  assert.equal(formatMoney(usd(100000000)), "$1,000,000.00");
});
