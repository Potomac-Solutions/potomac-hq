import assert from "node:assert/strict";
import { test } from "node:test";
import { place, scaleFor, spanOf, spanText } from "./timeline.ts";

test("a scale pads the dates, keeps today in view, and ticks Mondays", () => {
  const scale = scaleFor(["2026-12-01", null, "2026-12-20"], "2026-11-24");
  assert.ok(scale);
  assert.equal(scale.from, "2026-11-21", "three days before today, which is before the work");
  assert.equal(scale.to, "2026-12-23");
  assert.equal(scale.days, 33);
  assert.deepEqual(scale.ticks.map((tick) => tick.day), ["2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21"]);
  assert.equal(scale.ticks[0]?.label, "Nov 23");
  assert.ok(scale.today !== null && scale.today > 9 && scale.today < 11);
  assert.equal(scaleFor([null], "2026-11-24"), null);
});

test("a long scale ticks months; today far away is left out", () => {
  const scale = scaleFor(["2027-02-10", "2027-09-30"], "2026-06-01");
  assert.ok(scale);
  assert.equal(scale.today, null);
  assert.deepEqual(scale.ticks.map((tick) => tick.label).slice(0, 3), ["Mar", "Apr", "May"]);
  const across = scaleFor(["2026-11-10", "2027-06-01"], "2026-11-24");
  assert.ok(across?.ticks.some((tick) => tick.label === "Jan 2027"));
});

test("bars cover both days; a lone date is a point in its day", () => {
  const scale = scaleFor(["2026-12-01", "2026-12-10"], "2026-12-01");
  assert.ok(scale);
  assert.equal(scale.days, 16);
  assert.deepEqual(place(scale, "2026-12-01", "2026-12-10"), { left: 18.75, width: 62.5, point: false });
  assert.deepEqual(place(scale, null, "2026-12-01"), { left: 21.88, width: 0, point: true });
  assert.deepEqual(place(scale, "2026-12-05", "2026-12-05")?.point, true);
  assert.equal(place(scale, null, null), null);
});

test("words, and a span from parts", () => {
  assert.equal(spanText("2026-11-24", "2026-12-05"), "Nov 24 to Dec 5");
  assert.equal(spanText(null, "2026-12-05"), "Due Dec 5");
  assert.equal(spanText(null, "2026-12-05", "Target"), "Target Dec 5");
  assert.equal(spanText("2026-11-24", null), "Starts Nov 24");
  assert.deepEqual(spanOf([{ start: "2026-12-03", end: "2026-12-09" }, { start: null, end: "2026-12-20" }, { start: null, end: null }]), { start: "2026-12-03", end: "2026-12-20" });
  assert.deepEqual(spanOf([]), { start: null, end: null });
});
