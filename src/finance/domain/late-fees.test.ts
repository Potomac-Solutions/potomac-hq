import assert from "node:assert/strict";
import { test } from "node:test";
import { lateFeeDue, lateFeeWords, readLateFee, type LateFeeSetting } from "./late-fees.ts";

const late = { status: "sent", dueOn: "2026-10-01", owedMinor: 50000, isFee: false, charged: false };
const percent: LateFeeSetting = { kind: "percent", amount: 150, afterDays: 30 };

test("a late fee: off by default, after the days set, once, never on a fee, a percent of what's owed", () => {
  assert.equal(lateFeeDue({ kind: "off", amount: 0, afterDays: 30 }, late, "2026-11-26"), null);
  assert.equal(lateFeeDue(percent, late, "2026-10-30"), null, "29 days late");
  assert.equal(lateFeeDue(percent, late, "2026-10-31"), 750, "30 days: 1.5% of $500");
  assert.equal(lateFeeDue({ ...percent, since: "2026-11-01" }, late, "2026-11-26"), null, "already past its day when the fee was set: left alone");
  assert.equal(lateFeeDue({ ...percent, since: "2026-10-31" }, late, "2026-11-26"), 750, "reached its day the day the fee was set");
  assert.equal(lateFeeDue(percent, { ...late, owedMinor: 20000 }, "2026-11-26"), 300, "of what's still owed");
  assert.equal(lateFeeDue({ kind: "flat", amount: 2500, afterDays: 15 }, late, "2026-11-26"), 2500);
  assert.equal(lateFeeDue(percent, { ...late, charged: true }, "2026-11-26"), null);
  assert.equal(lateFeeDue(percent, { ...late, isFee: true }, "2026-11-26"), null);
  assert.equal(lateFeeDue(percent, { ...late, status: "paid" }, "2026-11-26"), null);
  assert.equal(lateFeeDue(percent, { ...late, dueOn: null }, "2026-11-26"), null);
});

test("the setting as typed: a percent up to 10, a dollar amount, 1 to 120 days", () => {
  assert.deepEqual(readLateFee({ kind: "percent", amount: "1.5%", afterDays: "30" }), { ok: true, value: { kind: "percent", amount: 150, afterDays: 30 } });
  assert.deepEqual(readLateFee({ kind: "flat", amount: "25", afterDays: "15" }), { ok: true, value: { kind: "flat", amount: 2500, afterDays: 15 } });
  assert.deepEqual(readLateFee({ kind: "percent", amount: "12", afterDays: "30" }), { ok: false, error: "invalid-late-fee-amount" });
  assert.deepEqual(readLateFee({ kind: "flat", amount: "25", afterDays: "0" }), { ok: false, error: "invalid-late-fee-days" });
  assert.deepEqual(readLateFee({ kind: "sometimes" }), { ok: false, error: "invalid-late-fee-kind" });
  assert.equal(lateFeeWords({ kind: "percent", amount: 150, afterDays: 30 }), "1.5% of what’s still owed, once, when an invoice is 30 days late");
  assert.equal(lateFeeWords({ kind: "flat", amount: 2500, afterDays: 15 }), "$25.00, once, when an invoice is 15 days late");
});
