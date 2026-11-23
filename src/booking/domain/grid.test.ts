import assert from "node:assert/strict";
import { test } from "node:test";
import { cellsFromRanges, gridRows, paintedIn, rangesFromCells, sameCells } from "./grid.ts";
import { openSlots, type BookingRules } from "./hours.ts";

test("painted cells next to each other make one stretch", () => {
  assert.deepEqual(rangesFromCells([600, 540, 570, 780, 810, 9999, 545]), [{ start: 540, end: 630 }, { start: 780, end: 840 }]);
  assert.deepEqual([...cellsFromRanges([{ start: 540, end: 630 }])], [540, 570, 600]);
  assert.ok(sameCells([{ start: 540, end: 600 }], [{ start: 540, end: 570 }, { start: 570, end: 600 }]));
});

test("the grid runs 6 AM to 10 PM, wider when the hours are", () => {
  const rows = gridRows([]);
  assert.deepEqual([rows[0], rows.at(-1), rows.length], [360, 1290, 32]);
  assert.equal(gridRows([{ start: 300, end: 1380 }])[0], 300);
  assert.equal(gridRows([{ start: 300, end: 1380 }]).at(-1), 1350);
});

test("a form's painted cells are read by column", () => {
  assert.deepEqual(paintedIn({ "c-1-540": "1", "c-1-570": "1", "c-2-540": "1", "c-1-600": "0", other: "1" }, "1"), [540, 570]);
});

test("a date painted differently replaces its weekday's hours; an empty one has no calls", () => {
  const rules: BookingRules = { callMinutes: 30, gapMinutes: 0, noticeHours: 0, daysAhead: 7, hours: [{ weekday: 1, start: 540, end: 600 }], closedDays: [], dates: { "2026-11-30": [{ start: 840, end: 900 }], "2026-12-07": [] } };
  const days = openSlots(rules, [], "2026-11-29T12:00:00Z", "America/New_York");
  assert.deepEqual(days.find((one) => one.day === "2026-11-30")?.slots.map((one) => one.label), ["2:00 PM", "2:30 PM"]);
  const later = openSlots({ ...rules, daysAhead: 14 }, [], "2026-11-29T12:00:00Z", "America/New_York");
  assert.equal(later.find((one) => one.day === "2026-12-07"), undefined);
});
