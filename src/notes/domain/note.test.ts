import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { newNote, NOTE_RECORD_TYPES, RECORD_VIEW_PERMISSION } from "./note.ts";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}` as Id;
const base = { recordType: "project", recordId: id(2), authorId: id(3), body: "  Called Ann. She wants the menu first.  " };

test("a note is trimmed and stamped", () => {
  assert.deepEqual(newNote(id(1), base, "2026-11-16T10:00:00.000Z"), {
    ok: true,
    value: { id: id(1), recordType: "project", recordId: id(2), authorId: id(3), body: "Called Ann. She wants the menu first.", createdAt: "2026-11-16T10:00:00.000Z" },
  });
});

test("an empty or huge note, or one on an unknown kind of record, is refused", () => {
  assert.deepEqual(newNote(id(1), { ...base, body: "   " }, "t"), { ok: false, error: "note-empty" });
  assert.deepEqual(newNote(id(1), { ...base, body: "x".repeat(5001) }, "t"), { ok: false, error: "note-too-long" });
  assert.deepEqual(newNote(id(1), { ...base, recordType: "user" }, "t"), { ok: false, error: "invalid-record-type" });
});

test("every kind of record a note can be on names the permission to see it", () => {
  for (const type of NOTE_RECORD_TYPES) assert.match(RECORD_VIEW_PERMISSION[type], /^[a-z]+\.view$/);
});
