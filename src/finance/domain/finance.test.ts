import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { budgetPeriod, defaultFinance, setBudget, setPayment, standing } from "./budget.ts";
import { newExpense } from "./expense.ts";
import { logEntry, MAX_TIMER_MINUTES, startEntry, stopEntry, weekOf } from "./time.ts";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}` as Id;
const ids = { id: id(1), projectId: id(2), taskId: null, userId: id(3) };
const usd = (minor: number) => ({ minor, currency: "USD" as const });
const TODAY = "2026-11-16";

test("time typed in afterwards: a day, hours and a note", () => {
  assert.deepEqual(logEntry(ids, { on: "2026-11-14", hours: "1.5", note: " Menu page " }, TODAY), {
    ok: true,
    value: { ...ids, workedOn: "2026-11-14", minutes: 90, note: "Menu page", billable: true, startedAt: null },
  });
  assert.deepEqual(logEntry(ids, { on: "2026-11-17", hours: "1" }, TODAY), { ok: false, error: "date-in-future" });
  assert.deepEqual(logEntry(ids, { on: "2026-11-14", hours: "" }, TODAY), { ok: false, error: "hours-missing" });
  assert.deepEqual(logEntry(ids, { on: "2026-11-14", hours: "0" }, TODAY), { ok: false, error: "hours-missing" });
  assert.deepEqual(logEntry(ids, { on: "2026-11-14", hours: "25" }, TODAY), { ok: false, error: "too-long-for-a-day" });
  assert.deepEqual(logEntry(ids, { on: "2026-11-14", hours: "a lot" }, TODAY), { ok: false, error: "invalid-hours" });
  assert.deepEqual(logEntry(ids, { on: "14 Nov", hours: "1" }, TODAY), { ok: false, error: "invalid-date" });
});

test("the timer rounds up to the minute, and a forgotten one is capped", () => {
  const running = startEntry(ids, "2026-11-16T14:00:00.000Z", TODAY);
  assert.equal(running.minutes, null);
  const stopped = stopEntry(running, "2026-11-16T14:40:01.000Z");
  assert.ok(stopped.ok);
  assert.equal(stopped.value.minutes, 41);
  assert.deepEqual(stopEntry(stopped.value, "2026-11-16T15:00:00.000Z"), { ok: false, error: "not-running" });
  const blink = stopEntry(running, "2026-11-16T14:00:02.000Z");
  assert.ok(blink.ok);
  assert.equal(blink.value.minutes, 1);
  const overnight = stopEntry(running, "2026-11-18T09:00:00.000Z");
  assert.ok(overnight.ok);
  assert.equal(overnight.value.minutes, MAX_TIMER_MINUTES);
});

test("a week runs Monday to Sunday", () => {
  assert.deepEqual(weekOf("2026-11-16"), { from: "2026-11-16", to: "2026-11-22" });
  assert.deepEqual(weekOf("2026-11-22"), { from: "2026-11-16", to: "2026-11-22" });
  assert.deepEqual(weekOf("2027-01-01"), { from: "2026-12-28", to: "2027-01-03" });
});

test("an expense has a category, a positive amount and a day that has happened", () => {
  const base = { id: id(1), projectId: id(2), recordedBy: id(3), receiptFileId: null };
  const made = newExpense(base, { category: "hosting", amount: "$12.50", on: "2026-11-10", note: "First month" }, TODAY);
  assert.deepEqual(made, { ok: true, value: { ...base, category: "hosting", amount: usd(1250), spentOn: "2026-11-10", note: "First month" } });
  assert.deepEqual(newExpense(base, { category: "lunch", amount: "5", on: TODAY }, TODAY), { ok: false, error: "invalid-category" });
  assert.deepEqual(newExpense(base, { category: "other", amount: "0", on: TODAY }, TODAY), { ok: false, error: "amount-must-be-positive" });
  assert.deepEqual(newExpense(base, { category: "other", amount: "five", on: TODAY }, TODAY), { ok: false, error: "not-an-amount" });
  assert.deepEqual(newExpense(base, { category: "other", amount: "5", on: "2026-12-01" }, TODAY), { ok: false, error: "date-in-future" });
});

test("a budget is set by hand, or left empty to follow the accepted proposal", () => {
  const start = defaultFinance(id(2));
  assert.deepEqual([start.budget, start.rate.minor, start.paymentStatus], [null, 7500, "not-invoiced"]);
  const set = setBudget(start, { amount: "2,400", hours: "32", rate: "60" });
  assert.ok(set.ok);
  assert.deepEqual([set.value.budget, set.value.budgetMinutes, set.value.rate], [usd(240000), 1920, usd(6000)]);
  const cleared = setBudget(set.value, { amount: "", hours: "", rate: "" });
  assert.ok(cleared.ok);
  assert.deepEqual([cleared.value.budget, cleared.value.budgetMinutes, cleared.value.rate.minor], [null, null, 7500]);
  assert.deepEqual(setBudget(start, { amount: "lots", hours: "", rate: "" }), { ok: false, error: "not-an-amount" });
  assert.deepEqual(setBudget(start, { amount: "", hours: "many", rate: "" }), { ok: false, error: "invalid-hours" });
  assert.deepEqual(setBudget(start, { amount: "", hours: "", rate: "0" }), { ok: false, error: "rate-must-be-positive" });
});

test("payment status is one of four, with the invoice's reference", () => {
  const paid = setPayment(defaultFinance(id(2)), { status: "invoiced", invoiceRef: " INV-0012 " });
  assert.ok(paid.ok);
  assert.deepEqual([paid.value.paymentStatus, paid.value.invoiceRef], ["invoiced", "INV-0012"]);
  assert.deepEqual(setPayment(defaultFinance(id(2)), { status: "overdue" }), { ok: false, error: "invalid-payment-status" });
});

test("estimate against actual: time is costed at the rate, expenses added, margin is what is left", () => {
  const budget = { amount: usd(240000), minutes: 1920 };
  const fine = standing(budget, { minutes: 600, billableMinutes: 600, expenses: usd(5000) }, usd(7500));
  assert.deepEqual(fine, { timeCost: usd(75000), cost: usd(80000), margin: usd(160000), marginPercent: 67, overHours: false, overCost: false, over: false });
  const overHours = standing(budget, { minutes: 1921, billableMinutes: 0, expenses: usd(0) }, usd(7500));
  assert.deepEqual([overHours.overHours, overHours.overCost, overHours.over], [true, true, true]);
  const overCost = standing(budget, { minutes: 60, billableMinutes: 60, expenses: usd(240000) }, usd(7500));
  assert.deepEqual([overCost.overHours, overCost.overCost, overCost.margin], [false, true, usd(-7500)]);
  const none = standing({ amount: null, minutes: null }, { minutes: 9999, billableMinutes: 0, expenses: usd(999999) }, usd(7500));
  assert.deepEqual([none.margin, none.marginPercent, none.over], [null, null, false], "with no budget, nothing is over it");
  assert.equal(standing({ amount: usd(0), minutes: null }, { minutes: 0, billableMinutes: 0, expenses: usd(0) }, usd(7500)).marginPercent, null);
});

test("a recurring plan is measured over its own period", () => {
  assert.deepEqual(budgetPeriod("monthly", "2026-02-10"), { from: "2026-02-01", to: "2026-02-28", label: "this month" });
  assert.deepEqual(budgetPeriod("yearly", "2026-02-10"), { from: "2026-01-01", to: "2026-12-31", label: "this year" });
  assert.equal(budgetPeriod("fixed", "2026-02-10").label, "so far");
  assert.equal(budgetPeriod(null, "2026-02-10").label, "so far");
});
