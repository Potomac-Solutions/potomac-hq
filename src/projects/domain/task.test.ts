import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { byUrgency, editTask, formatHours, isTaskOverdue, moveTask, newTask, parseHours, type Task } from "./task.ts";

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}` as Id;

function task(over: Partial<Task> = {}): Task {
  const made = newTask(id(1), id(2), { title: "Draft the menu page" });
  assert.ok(made.ok);
  return { ...made.value, ...over };
}

test("a new task is to do, normal priority, with nothing else set", () => {
  assert.deepEqual(task(), { id: id(1), projectId: id(2), phaseId: null, title: "Draft the menu page", description: "", assigneeId: null, priority: "normal", dueOn: null, startOn: null, estimateMinutes: null, status: "todo", doneAt: null });
});

test("a start date is never after the due date, and an edit without one keeps it", () => {
  assert.deepEqual(newTask(id(1), id(2), { title: "Build", startOn: "2026-12-05", dueOn: "2026-12-01" }), { ok: false, error: "start-after-due" });
  const made = newTask(id(1), id(2), { title: "Build", startOn: "2026-11-24", dueOn: "2026-12-01" });
  assert.ok(made.ok);
  const kept = editTask(made.value, { title: "Build it", dueOn: "2026-12-02" });
  assert.ok(kept.ok);
  assert.equal(kept.value.startOn, "2026-11-24");
  const cleared = editTask(made.value, { title: "Build", startOn: "", dueOn: "2026-12-01" });
  assert.ok(cleared.ok);
  assert.equal(cleared.value.startOn, null);
  assert.deepEqual(editTask(made.value, { title: "Build", dueOn: "2026-11-20" }), { ok: false, error: "start-after-due" }, "moving the due date before a kept start");
});

test("a task's fields are checked", () => {
  const full = newTask(id(1), id(2), { title: "Build", assigneeId: id(3), phaseId: id(4), priority: "urgent", dueOn: "2026-12-01", estimate: "1.5", description: "All pages." });
  assert.ok(full.ok);
  assert.deepEqual({ a: full.value.assigneeId, p: full.value.priority, d: full.value.dueOn, e: full.value.estimateMinutes }, { a: id(3), p: "urgent", d: "2026-12-01", e: 90 });
  assert.deepEqual(newTask(id(1), id(2), { title: "" }), { ok: false, error: "title-missing" });
  assert.deepEqual(newTask(id(1), id(2), { title: "x", priority: "asap" }), { ok: false, error: "invalid-priority" });
  assert.deepEqual(newTask(id(1), id(2), { title: "x", dueOn: "soon" }), { ok: false, error: "invalid-date" });
  assert.deepEqual(newTask(id(1), id(2), { title: "x", estimate: "two" }), { ok: false, error: "invalid-estimate" });
});

test("hours are read as people type them", () => {
  assert.deepEqual(parseHours(""), { ok: true, value: null });
  assert.deepEqual(parseHours("2"), { ok: true, value: 120 });
  assert.deepEqual(parseHours("0.25"), { ok: true, value: 15 });
  assert.deepEqual(parseHours("-1"), { ok: false, error: "invalid-hours" });
  assert.deepEqual(parseHours("99999"), { ok: false, error: "invalid-hours" });
  assert.equal(formatHours(90), "1.5");
  assert.equal(formatHours(120), "2");
  assert.equal(formatHours(15), "0.25");
});

test("editing keeps the status; moving stamps and clears the done time", () => {
  const doing = moveTask(task(), "doing", "2026-11-16T10:00:00.000Z");
  assert.ok(doing.ok);
  assert.equal(doing.value.doneAt, null);
  const edited = editTask(doing.value, { title: "Draft the menu", priority: "high" });
  assert.ok(edited.ok);
  assert.equal(edited.value.status, "doing");
  const done = moveTask(edited.value, "done", "2026-11-17T10:00:00.000Z");
  assert.ok(done.ok);
  assert.equal(done.value.doneAt, "2026-11-17T10:00:00.000Z");
  const back = moveTask(done.value, "todo", "2026-11-18T10:00:00.000Z");
  assert.ok(back.ok);
  assert.equal(back.value.doneAt, null);
  assert.deepEqual(moveTask(task(), "todo", "t"), { ok: false, error: "unchanged" });
  assert.deepEqual(moveTask(task(), "archived", "t"), { ok: false, error: "invalid-status" });
});

test("overdue means open and past its date", () => {
  assert.equal(isTaskOverdue(task({ dueOn: "2026-11-15" }), "2026-11-16"), true);
  assert.equal(isTaskOverdue(task({ dueOn: "2026-11-16" }), "2026-11-16"), false);
  assert.equal(isTaskOverdue(task({ dueOn: "2026-11-15", status: "done", doneAt: "t" }), "2026-11-16"), false);
});

test("tasks sort by priority, then due date, then title", () => {
  const list = [task({ title: "c" }), task({ title: "b", dueOn: "2026-12-01" }), task({ title: "a", priority: "urgent" }), task({ title: "d", dueOn: "2026-11-20" })];
  assert.deepEqual(list.sort(byUrgency).map((t) => t.title), ["a", "d", "b", "c"]);
});

test("a to-do (a task without a project) is only to do or done", () => {
  const todo: Task = { ...task(), projectId: null };
  assert.deepEqual(moveTask(todo, "doing", "2026-11-16T10:00:00.000Z"), { ok: false, error: "todo-has-no-board" });
  assert.deepEqual(moveTask(todo, "blocked", "2026-11-16T10:00:00.000Z"), { ok: false, error: "todo-has-no-board" });
  const done = moveTask(todo, "done", "2026-11-16T10:00:00.000Z");
  assert.ok(done.ok);
  assert.equal(done.value.doneAt, "2026-11-16T10:00:00.000Z");
});
