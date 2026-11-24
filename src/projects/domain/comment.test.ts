import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { commentPieces, editComment, mayChangeComment, mentionsIn, newComment } from "./comment.ts";

const at = "2026-11-24T17:00:00.000Z";
const later = "2026-11-24T18:00:00.000Z";

test("a comment has words, not too many; editing marks it edited, unless nothing changed", () => {
  assert.deepEqual(newComment("c" as Id, "t" as Id, "u" as Id, "   ", at), { ok: false, error: "comment-empty" });
  assert.deepEqual(newComment("c" as Id, "t" as Id, "u" as Id, "x".repeat(5001), at), { ok: false, error: "comment-too-long" });
  const made = newComment("c" as Id, "t" as Id, "u" as Id, "  Proof sent.  ", at);
  assert.ok(made.ok);
  assert.equal(made.value.body, "Proof sent.");
  assert.equal(made.value.editedAt, null);
  assert.deepEqual(editComment(made.value, "Proof sent.", later), { ok: false, error: "unchanged" });
  const edited = editComment(made.value, "Proof sent to Dale.", later);
  assert.ok(edited.ok);
  assert.equal(edited.value.editedAt, later);
  assert.equal(mayChangeComment(made.value, "u" as Id), true);
  assert.equal(mayChangeComment(made.value, "admin" as Id), false);
});

test("mentions: @handles once each, not email addresses", () => {
  assert.deepEqual(mentionsIn("@sam can you check? cc @Jayanti, @sam. Mail dale@example.com"), ["sam", "jayanti"]);
  assert.deepEqual(mentionsIn("@sam-rivers: done"), ["sam-rivers"]);
  assert.deepEqual(mentionsIn("no one"), []);
});

test("pieces mark only the mentions of known people", () => {
  assert.deepEqual(commentPieces("Thanks @sam, ask @nobody.", new Set(["sam"])), [
    { text: "Thanks ", mention: false },
    { text: "@sam", mention: true },
    { text: ", ask @nobody.", mention: false },
  ]);
  assert.deepEqual(commentPieces("@sam", new Set(["sam"])), [{ text: "@sam", mention: true }]);
});
