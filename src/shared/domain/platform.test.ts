// Scaffold check: the domain test runner works with nothing installed, and the
// runtime provides what docs/data-model.md relies on. Replace with real domain
// rule tests as they arrive.
import assert from "node:assert/strict";
import { test } from "node:test";

test("Temporal is built in", () => {
  const followUp = Temporal.PlainDate.from("2026-11-20");
  assert.equal(followUp.add({ days: 3 }).toString(), "2026-11-23");
});

test("a calendar date resolves in the business time zone", () => {
  const instant = Temporal.Instant.from("2026-11-15T02:30:00Z");
  const local = instant.toZonedDateTimeISO("America/New_York").toPlainDate();
  assert.equal(local.toString(), "2026-11-14");
});
