import assert from "node:assert/strict";
import { test } from "node:test";
import { readUndo, stashUndo, withUndo } from "./forms.ts";

test("an undo in an address is swapped for a token before it's signed (decision 0014)", () => {
  const kept: { action: string; fields: Readonly<Record<string, string>> }[] = [];
  const keep = (action: string, fields: Readonly<Record<string, string>>) => (kept.push({ action, fields }), "0".repeat(32));
  const long = "x".repeat(4000);
  const location = withUndo("/tasks/1?done=Saved.#top", { action: "/tasks/1", fields: { title: "Old", description: long } });
  const swapped = stashUndo(location, keep);
  assert.equal(swapped, `/tasks/1?done=Saved.&undo=%2Fundo%2F${"0".repeat(32)}#top`);
  assert.deepEqual(kept, [{ action: "/tasks/1", fields: { title: "Old", description: long } }]);
  assert.deepEqual(readUndo(`/undo/${"0".repeat(32)}`), { action: `/undo/${"0".repeat(32)}`, fields: [] });

  assert.equal(stashUndo("/tasks/1?done=Saved.", keep), "/tasks/1?done=Saved.", "nothing to undo, nothing kept");
  assert.doesNotMatch(stashUndo("/x?undo=%2F%2Fevil.example%2Fa", keep), /undo=/, "only a plain HQ post is kept");
  assert.equal(withUndo("/x", { action: "https://evil.example/a", fields: {} }), "/x");
  assert.equal(kept.length, 1);
});
