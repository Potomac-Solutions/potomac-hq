import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { mayBlock, mayHaveSubtasks, progressText } from "./dependencies.ts";

const id = (name: string) => name as Id;

test("subtasks go one level deep, under project tasks only", () => {
  assert.deepEqual(mayHaveSubtasks({ projectId: id("p"), parentId: null }), { ok: true, value: "p" });
  assert.deepEqual(mayHaveSubtasks({ projectId: null, parentId: null }), { ok: false, error: "parent-is-a-todo" });
  assert.deepEqual(mayHaveSubtasks({ projectId: id("p"), parentId: id("q") }), { ok: false, error: "parent-is-a-subtask" });
});

test("blocking can't point at itself, repeat, or close a circle", () => {
  // c waits on b, b waits on a.
  const edges: Record<string, Id[]> = { c: [id("b")], b: [id("a")] };
  const of = (task: Id) => edges[task] ?? [];
  assert.equal(mayBlock(id("d"), id("c"), of).ok, true);
  assert.deepEqual(mayBlock(id("a"), id("a"), of), { ok: false, error: "blocks-itself" });
  assert.deepEqual(mayBlock(id("c"), id("b"), of), { ok: false, error: "already-blocked" });
  assert.deepEqual(mayBlock(id("a"), id("c"), of), { ok: false, error: "makes-a-circle" }, "a waits on c, which waits on a");
  assert.deepEqual(mayBlock(id("b"), id("c"), of), { ok: false, error: "makes-a-circle" });
  assert.equal(mayBlock(id("c"), id("a"), of).ok, true, "waiting on something twice over is no circle");
});

test("progress", () => {
  assert.equal(progressText({ done: 3, total: 5 }), "3 of 5 done");
  assert.equal(progressText({ done: 0, total: 0 }), "");
  assert.equal(progressText(undefined), "");
});
