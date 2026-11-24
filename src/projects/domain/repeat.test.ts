import assert from "node:assert/strict";
import { test } from "node:test";
import { nextDue, readRepeat, repeatText, shiftBy, type Repeat } from "./repeat.ts";

const weekly: Repeat = { every: 1, unit: "week", from: "due" };

test("reading a repeat from a form", () => {
  assert.deepEqual(readRepeat({ every: "2", unit: "week", from: "done" }), { ok: true, value: { every: 2, unit: "week", from: "done" } });
  assert.deepEqual(readRepeat({ every: "", unit: "month" }), { ok: true, value: { every: 1, unit: "month", from: "due" } });
  for (const bad of [{ every: "0", unit: "day" }, { every: "1.5", unit: "day" }, { every: "400", unit: "day" }, { every: "1", unit: "fortnight" }, { every: "1", unit: "day", from: "later" }]) {
    assert.equal(readRepeat(bad).ok, false, JSON.stringify(bad));
  }
});

test("from the due date: the first one after the day it was done", () => {
  assert.equal(nextDue(weekly, "2026-11-23", "2026-11-23"), "2026-11-30", "on time");
  assert.equal(nextDue(weekly, "2026-11-23", "2026-11-20"), "2026-11-30", "early");
  assert.equal(nextDue(weekly, "2026-11-02", "2026-11-25"), "2026-11-30", "three weeks late catches up");
  assert.equal(nextDue({ every: 1, unit: "month", from: "due" }, "2027-01-31", "2027-01-31"), "2027-02-28");
  assert.equal(nextDue({ every: 1, unit: "month", from: "due" }, "2027-01-31", "2027-03-01"), "2027-03-31", "the 31st comes back where it can");
  assert.equal(nextDue({ every: 1, unit: "year", from: "due" }, "2028-02-29", "2028-02-29"), "2029-02-28");
});

test("from the day it's done, or with no due date", () => {
  assert.equal(nextDue({ every: 10, unit: "day", from: "done" }, "2026-11-01", "2026-11-24"), "2026-12-04");
  assert.equal(nextDue(weekly, null, "2026-11-24"), "2026-12-01");
});

test("subtasks' dates move as far as their parent's", () => {
  assert.equal(shiftBy("2026-11-23", "2026-11-30", "2026-11-20"), "2026-11-27");
  assert.equal(shiftBy(null, "2026-11-30", "2026-11-20"), null);
  assert.equal(shiftBy("2026-11-23", "2026-11-30", null), null);
});

test("in words", () => {
  assert.equal(repeatText(weekly), "Every week, from the due date");
  assert.equal(repeatText({ every: 3, unit: "month", from: "done" }), "Every 3 months, from the day it’s done");
  assert.equal(repeatText(null), "");
});
