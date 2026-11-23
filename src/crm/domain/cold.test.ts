import assert from "node:assert/strict";
import { test } from "node:test";
import { quietDays } from "./cold.ts";

test("two weeks quiet with no follow-up is going cold", () => {
  assert.equal(quietDays({ followUpOn: null }, "2026-11-08", "2026-11-22"), 14);
  assert.equal(quietDays({ followUpOn: null }, "2026-11-09", "2026-11-22"), null, "13 days is not yet");
  assert.equal(quietDays({ followUpOn: "2026-11-01" }, "2026-10-01", "2026-11-22"), null, "a follow-up, even an overdue one, is a plan");
});
