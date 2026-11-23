import assert from "node:assert/strict";
import { test } from "node:test";
import { newTodo, stateOf } from "./todo.ts";
import type { Id } from "../../shared/domain/id.ts";

const ids = { id: "1" as Id, assigneeId: "2" as Id, organizationId: null, opportunityId: null, createdBy: "2" as Id };

test("a to-do needs a title and, if it has one, a real day", () => {
  assert.deepEqual(newTodo(ids, { title: "  " }), { ok: false, error: "title-missing" });
  assert.deepEqual(newTodo(ids, { title: "x".repeat(201) }), { ok: false, error: "title-too-long" });
  assert.deepEqual(newTodo(ids, { title: "Send the quote", dueOn: "2026-02-30" }), { ok: false, error: "invalid-date" });
  const made = newTodo(ids, { title: " Send the quote ", dueOn: "" });
  assert.ok(made.ok);
  assert.equal(made.value.title, "Send the quote");
  assert.equal(made.value.dueOn, null);
  assert.equal(made.value.doneAt, null);
});

test("an open to-do is overdue, for today, upcoming or for whenever", () => {
  assert.equal(stateOf({ dueOn: "2026-11-21" }, "2026-11-22"), "overdue");
  assert.equal(stateOf({ dueOn: "2026-11-22" }, "2026-11-22"), "today");
  assert.equal(stateOf({ dueOn: "2026-11-23" }, "2026-11-22"), "upcoming");
  assert.equal(stateOf({ dueOn: null }, "2026-11-22"), "someday");
});
