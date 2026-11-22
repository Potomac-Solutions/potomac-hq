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
