import assert from "node:assert/strict";
import { test } from "node:test";
import { readFeedback } from "./feedback.ts";

test("a score of 1 to 5 and an optional line", () => {
  assert.deepEqual(readFeedback({ score: "5", note: "  Loved it " }), { ok: true, value: { score: 5, note: "Loved it" } });
  for (const bad of ["0", "6", "4.5", "", "five"]) assert.deepEqual(readFeedback({ score: bad }), { ok: false, error: "invalid-score" }, bad);
  assert.deepEqual(readFeedback({ score: "2", note: "x".repeat(1001) }), { ok: false, error: "note-too-long" });
});
