import { test } from "node:test";
import assert from "node:assert/strict";
import { workloadLines } from "./workload.ts";

const row = (name: string, more: Partial<Parameters<typeof workloadLines>[0][number]> = {}) => ({ userId: name, name, open: 3, dueThisWeek: 2, overdue: 0, minutesThisWeek: 600, minutesLastFourWeeks: 4 * 1200, ...more });

test("whoever needs a look comes first, with why", () => {
  const lines = workloadLines([row("Ann"), row("Bea", { overdue: 2 }), row("Cal", { dueThisWeek: 10 })], 5);
  assert.deepEqual(lines.map((one) => [one.name, one.flag]), [["Cal", "10 due this week"], ["Bea", "2 overdue"], ["Ann", ""]]);
  assert.equal(lines[2]?.hours, "10 h");
  assert.equal(lines[2]?.usual, "20 h");
  assert.equal(lines[2]?.href, "/work?who=Ann");
});

test("hours are against their own usual week, so far", () => {
  assert.equal(workloadLines([row("Ann", { minutesThisWeek: 900 })], 2)[0]?.flag, "more hours than usual", "Tuesday, already 15 h of a usual 20");
  assert.equal(workloadLines([row("Ann", { minutesThisWeek: 900 })], 5)[0]?.flag, "");
  assert.equal(workloadLines([row("New", { minutesThisWeek: 2000, minutesLastFourWeeks: 0 })], 3)[0]?.flag, "", "no usual week yet");
});
