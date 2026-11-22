import assert from "node:assert/strict";
import { test } from "node:test";
import { daysUntil, dueText, friendlyDay, howSoon } from "./days.ts";

const TODAY = "2026-11-16";

test("a day reads as a weekday and a date, with the year only when it differs", () => {
  assert.equal(friendlyDay("2026-11-21", TODAY), "Sat, Nov 21");
  assert.equal(friendlyDay("2026-11-16", TODAY), "Mon, Nov 16");
  assert.equal(friendlyDay("2027-01-04", TODAY), "Mon, Jan 4, 2027");
  assert.equal(friendlyDay("2028-02-29", TODAY), "Tue, Feb 29, 2028");
  assert.equal(friendlyDay("", TODAY), "");
  assert.equal(friendlyDay("2026-02-30", TODAY), "2026-02-30", "not a day: left as it was");
  assert.equal(friendlyDay("Thursday Nov 19, 2:00 PM", TODAY), "Thursday Nov 19, 2:00 PM");
});

test("how far off a day is, in words", () => {
  assert.equal(howSoon("2026-11-16", TODAY), "today");
  assert.equal(howSoon("2026-11-17", TODAY), "tomorrow");
  assert.equal(howSoon("2026-11-15", TODAY), "yesterday");
  assert.equal(howSoon("2026-11-21", TODAY), "in 5 days");
  assert.equal(howSoon("2026-11-13", TODAY), "3 days ago");
  assert.equal(howSoon("soon", TODAY), "");
  assert.equal(daysUntil("2027-11-16", TODAY), 365);
  assert.equal(daysUntil("2026-03-08", "2026-03-07"), 1, "a clock change does not make a day longer");
  assert.equal(dueText("2026-11-21", TODAY), "Sat, Nov 21, in 5 days");
  assert.equal(dueText("nonsense", TODAY), "nonsense");
});
