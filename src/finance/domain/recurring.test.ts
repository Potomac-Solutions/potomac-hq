import assert from "node:assert/strict";
import { test } from "node:test";
import { isDue, monthlyMinor, newRecurring, nextAfter, periodLine } from "./recurring.ts";
import type { Id } from "../../shared/domain/id.ts";

const ids = { id: "11111111-1111-4111-8111-111111111111" as Id, organizationId: "44444444-4444-4444-8444-444444444444" as Id, projectId: "22222222-2222-4222-8222-222222222222" as Id, createdBy: "33333333-3333-4333-8333-333333333333" as Id };

test("a recurring invoice is checked, and due 15 days after sending unless set", () => {
  const made = newRecurring(ids, { description: " Hosting and care ", amount: "49", every: "month", firstOn: "2027-01-31" });
  assert.ok(made.ok);
  assert.deepEqual([made.value.description, made.value.amount.minor, made.value.anchorDay, made.value.nextOn, made.value.dueDays, made.value.autoSend], ["Hosting and care", 4900, 31, "2027-01-31", 15, false]);
  assert.deepEqual(newRecurring(ids, { description: "x", amount: "0", every: "month", firstOn: "2027-01-01" }), { ok: false, error: "amount-must-be-positive" });
  assert.deepEqual(newRecurring(ids, { description: "x", amount: "1", every: "week", firstOn: "2027-01-01" }), { ok: false, error: "invalid-every" });
  assert.deepEqual(newRecurring(ids, { description: "x", amount: "1", every: "month", firstOn: "2027-02-01", endsOn: "2027-01-01" }), { ok: false, error: "ends-before-start" });
  assert.deepEqual(newRecurring(ids, { description: "x", amount: "1", every: "month", firstOn: "2027-02-01", dueDays: "91" }), { ok: false, error: "invalid-due-days" });
});

test("the next day keeps to the anchor day, or the month's last", () => {
  assert.equal(nextAfter("2027-01-31", "month", 31), "2027-02-28");
  assert.equal(nextAfter("2027-02-28", "month", 31), "2027-03-31", "back to the 31st, not stuck on the 28th");
  assert.equal(nextAfter("2028-01-31", "month", 31), "2028-02-29", "a leap year");
  assert.equal(nextAfter("2027-11-15", "quarter", 15), "2028-02-15");
  assert.equal(nextAfter("2027-02-28", "year", 29), "2028-02-29");
});

test("the invoice line names its period, and the monthly figure spreads longer ones", () => {
  const made = newRecurring(ids, { description: "Hosting", amount: "120", every: "quarter", firstOn: "2027-01-01" });
  assert.ok(made.ok);
  assert.equal(periodLine({ ...made.value, every: "month" }, "2026-12-01"), "Hosting, December 2026");
  assert.equal(periodLine(made.value, "2027-01-01"), "Hosting, Jan to Mar 2027");
  assert.equal(periodLine({ ...made.value, every: "year" }, "2027-03-01"), "Hosting, Mar 2027 to Feb 2028");
  assert.equal(monthlyMinor(made.value), 4000);
  assert.equal(isDue(made.value, "2026-12-31"), false);
  assert.equal(isDue(made.value, "2027-01-01"), true);
  assert.equal(isDue({ ...made.value, active: false }, "2027-01-01"), false);
  assert.equal(isDue({ ...made.value, endsOn: "2026-12-31" }, "2027-01-01"), false);
});
