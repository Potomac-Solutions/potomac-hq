import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { firesAt, isReminderDue, noticesFromEvent, readReminder, reminderText, snippet, type Reminder } from "./notice.ts";

const ZONE = "America/New_York";
const mikey = "mikey" as Id;
const sam = "sam" as Id;
const task = "task" as Id;
const event = (action: string, context: Record<string, unknown>, actorId: Id | null = mikey) => ({ actorId, action, recordId: task, context });

test("assignments make a notice for the person given it, unless they gave it themselves", () => {
  assert.deepEqual(noticesFromEvent(event("task.added", { assigneeId: sam })), [{ userId: sam, kind: "assigned", taskId: task, actorId: mikey, detail: "" }]);
  assert.deepEqual(noticesFromEvent(event("todo.added", { assigneeId: sam })).length, 1);
  assert.deepEqual(noticesFromEvent(event("task.added", { assigneeId: mikey })), []);
  assert.deepEqual(noticesFromEvent(event("task.added", { assigneeId: null })), []);
  assert.equal(noticesFromEvent(event("task.edited", { assigneeId: sam, assigneeWas: null })).length, 1);
  assert.equal(noticesFromEvent(event("task.edited", { assigneeId: sam, assigneeWas: sam })).length, 0, "an edit that keeps the person isn't news");
  assert.equal(noticesFromEvent(event("task.repeated", { assigneeId: sam })).length, 0);
});

test("mentions make a notice for each person mentioned, but not the writer", () => {
  const made = noticesFromEvent(event("comment.added", { body: "Can you look, @sam? @mikey too", mentions: [sam, mikey] }, sam));
  assert.deepEqual(made, [{ userId: mikey, kind: "mentioned", taskId: task, actorId: sam, detail: "Can you look, @sam? @mikey too" }]);
  assert.equal(noticesFromEvent(event("comment.edited", { body: "x", mentions: [] })).length, 0);
});

test("snippets cut long comments at a word", () => {
  const long = "word ".repeat(60);
  const cut = snippet(long);
  assert.ok(cut.length <= 141);
  assert.ok(cut.endsWith("word…"));
  assert.equal(snippet("  short\n\nnote "), "short note");
});

test("reading reminders: a future time, or days before at a time of day", () => {
  const now = Temporal.Instant.from("2026-11-24T18:00:00Z");
  assert.deepEqual(readReminder({ kind: "at", when: "2026-11-25T09:30" }, ZONE, now), { ok: true, value: { at: "2026-11-25T14:30:00Z", daysBefore: null, time: null } });
  assert.deepEqual(readReminder({ kind: "at", when: "2026-11-24T08:00" }, ZONE, now), { ok: false, error: "reminder-in-the-past" });
  assert.deepEqual(readReminder({ kind: "at", when: "tomorrow" }, ZONE, now), { ok: false, error: "invalid-reminder" });
  assert.deepEqual(readReminder({ kind: "before", daysBefore: "2", time: "09:00" }, ZONE, now), { ok: true, value: { at: null, daysBefore: 2, time: "09:00" } });
  for (const bad of [{ daysBefore: "31", time: "09:00" }, { daysBefore: "-1", time: "09:00" }, { daysBefore: "1", time: "25:00" }]) {
    assert.equal(readReminder({ kind: "before", ...bad }, ZONE, now).ok, false, JSON.stringify(bad));
  }
});

test("when a reminder fires, and again when the due date moves", () => {
  const before: Reminder = { id: "r" as Id, taskId: task, userId: sam, at: null, daysBefore: 1, time: "09:00", sentAt: null, sentForDue: null };
  assert.equal(firesAt(before, "2026-12-01", ZONE)?.toString(), "2026-11-30T14:00:00Z");
  assert.equal(firesAt(before, null, ZONE), null);
  const at = (iso: string) => Temporal.Instant.from(iso);
  assert.equal(isReminderDue(before, { dueOn: "2026-12-01", done: false }, at("2026-11-30T13:59:00Z"), ZONE), false);
  assert.equal(isReminderDue(before, { dueOn: "2026-12-01", done: false }, at("2026-11-30T14:00:00Z"), ZONE), true);
  assert.equal(isReminderDue(before, { dueOn: "2026-12-01", done: true }, at("2026-11-30T14:00:00Z"), ZONE), false);
  const sent = { ...before, sentAt: "2026-11-30T14:00:00Z", sentForDue: "2026-12-01" };
  assert.equal(isReminderDue(sent, { dueOn: "2026-12-01", done: false }, at("2026-12-01T00:00:00Z"), ZONE), false);
  assert.equal(isReminderDue(sent, { dueOn: "2026-11-28", done: false }, at("2026-12-01T00:00:00Z"), ZONE), true, "moved: fires for the new date");
  const once: Reminder = { ...before, at: "2026-11-25T14:30:00Z", daysBefore: null, time: null };
  assert.equal(isReminderDue(once, { dueOn: null, done: false }, at("2026-11-25T14:30:00Z"), ZONE), true);
  assert.equal(isReminderDue({ ...once, sentAt: "x" }, { dueOn: null, done: false }, at("2026-11-26T00:00:00Z"), ZONE), false);
});

test("reminders in words", () => {
  assert.equal(reminderText({ at: "2026-11-25T14:30:00Z", daysBefore: null, time: null }, ZONE), "Wed, Nov 25 at 9:30 AM");
  assert.equal(reminderText({ at: null, daysBefore: 0, time: "08:00" }, ZONE), "The day it's due, at 8:00 AM");
  assert.equal(reminderText({ at: null, daysBefore: 1, time: "16:30" }, ZONE), "The day before it's due, at 4:30 PM");
  assert.equal(reminderText({ at: null, daysBefore: 3, time: "09:00" }, ZONE), "3 days before it's due, at 9:00 AM");
});
