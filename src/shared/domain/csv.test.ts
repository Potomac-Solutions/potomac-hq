import assert from "node:assert/strict";
import { test } from "node:test";
import { csvField, toCsv } from "./csv.ts";
import { formatHours, parseHours } from "./hours.ts";

test("fields are quoted only when they need it", () => {
  assert.equal(csvField("Bakery website"), "Bakery website");
  assert.equal(csvField('Ann said "yes", then left'), '"Ann said ""yes"", then left"');
  assert.equal(csvField("two\nlines"), '"two\nlines"');
  assert.equal(csvField(90), "90");
  assert.equal(csvField(null), "");
});

test("text a spreadsheet would run as a formula is defused", () => {
  assert.equal(csvField("=HYPERLINK(\"http://evil\")"), "\"'=HYPERLINK(\"\"http://evil\"\")\"");
  assert.equal(csvField("+1 304 555 0100"), "'+1 304 555 0100");
  assert.equal(csvField("-5"), "'-5");
  assert.equal(csvField("@cmd"), "'@cmd");
  assert.equal(csvField(-5), "-5", "a real number stays a number");
  assert.equal(csvField(-7.5), "-7.5");
  assert.equal(csvField(1234.56), "1234.56");
});

test("a file starts with a byte order mark and ends every row with CRLF", () => {
  assert.equal(toCsv(["Day", "Hours"], [["2026-11-16", 1.5], ["2026-11-17", null]]), "\uFEFFDay,Hours\r\n2026-11-16,1.5\r\n2026-11-17,\r\n");
});

test("hours are read and written the way people write them", () => {
  assert.deepEqual(parseHours("1.5"), { ok: true, value: 90 });
  assert.deepEqual(parseHours(""), { ok: true, value: null });
  assert.deepEqual(parseHours("1h"), { ok: false, error: "invalid-hours" });
  assert.equal(formatHours(100), "1.67");
});
