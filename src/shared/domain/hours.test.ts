import assert from "node:assert/strict";
import { test } from "node:test";
import { formatHours, parseHours, readableHours } from "./hours.ts";

test("time worked reads as hours and minutes, never as a decimal", () => {
  assert.equal(readableHours(151), "2 h 31 min");
  assert.equal(readableHours(120), "2 h");
  assert.equal(readableHours(45), "45 min");
  assert.equal(readableHours(0), "0 h");
  assert.equal(readableHours(60 * 1234 + 5), "1,234 h 5 min");
  assert.equal(readableHours(-3), "0 h");
});

test("a form still round-trips hours as people type them", () => {
  assert.equal(formatHours(90), "1.5");
  assert.equal(formatHours(100), "1.67");
  assert.deepEqual(parseHours(formatHours(90)), { ok: true, value: 90 });
});

test("hours can be typed without a leading zero or after a bare point", () => {
  assert.deepEqual(parseHours(".25"), { ok: true, value: 15 });
  assert.deepEqual(parseHours("0.25"), { ok: true, value: 15 });
  assert.deepEqual(parseHours(" .5 "), { ok: true, value: 30 });
  assert.deepEqual(parseHours("2."), { ok: true, value: 120 });
  assert.deepEqual(parseHours(""), { ok: true, value: null });
  for (const bad of [".", "-1", "1.255", ".255", "abc", "1,5", "100000"]) assert.deepEqual(parseHours(bad), { ok: false, error: "invalid-hours" }, bad);
});
