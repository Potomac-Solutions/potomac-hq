import { test } from "node:test";
import assert from "node:assert/strict";
import { undoable, type UndoStep } from "./undo.ts";

const step: UndoStep = { id: "u1", userId: "me", kind: "task-status", recordId: "t1", was: "todo", label: "Moved it", createdAt: "2026-11-25T20:00:00Z", usedAt: null };

test("a change can be undone by whoever made it, once, for ten minutes", () => {
  assert.equal(undoable(step, "me", "2026-11-25T20:09:59Z"), true);
  assert.equal(undoable(step, "me", "2026-11-25T20:10:01Z"), false);
  assert.equal(undoable(step, "someone else", "2026-11-25T20:01:00Z"), false);
  assert.equal(undoable({ ...step, usedAt: "2026-11-25T20:02:00Z" }, "me", "2026-11-25T20:03:00Z"), false);
  assert.equal(undoable(null, "me", "2026-11-25T20:03:00Z"), false);
});
