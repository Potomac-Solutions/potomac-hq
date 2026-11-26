import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { carriedTiming, firesAt, isReminderDue, noticesFromEvent, readReminder, reminderRecipient, reminderText, snippet, type Reminder } from "./notice.ts";

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
  assert.deepEqual(readReminder({ kind: "at", when: "2026-11-25T09:30" }, ZONE, now), { ok: true, value: { at: "2026-11-25T14:30:00Z", daysBefore: null, time: null, forWhom: "me", carry: false } });
  assert.deepEqual(readReminder({ kind: "at", when: "2026-11-24T08:00" }, ZONE, now), { ok: false, error: "reminder-in-the-past" });
  assert.deepEqual(readReminder({ kind: "at", when: "tomorrow" }, ZONE, now), { ok: false, error: "invalid-reminder" });
  assert.deepEqual(readReminder({ kind: "before", daysBefore: "2", time: "09:00", forWhom: "assignee", carry: true }, ZONE, now), { ok: true, value: { at: null, daysBefore: 2, time: "09:00", forWhom: "assignee", carry: true } });
  assert.deepEqual(readReminder({ kind: "before", daysBefore: "2", time: "09:00", forWhom: "everyone" }, ZONE, now), { ok: false, error: "invalid-reminder" });
  for (const bad of [{ daysBefore: "31", time: "09:00" }, { daysBefore: "-1", time: "09:00" }, { daysBefore: "1", time: "25:00" }]) {
    assert.equal(readReminder({ kind: "before", ...bad }, ZONE, now).ok, false, JSON.stringify(bad));
  }
});

test("when a reminder fires, and again when the due date moves", () => {
  const before: Reminder = { id: "r" as Id, taskId: task, userId: sam, at: null, daysBefore: 1, time: "09:00", forWhom: "me", carry: false, sentAt: null, sentForDue: null };
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

test("who a reminder tells, and how it carries to the next of a repeat", () => {
  assert.equal(reminderRecipient({ forWhom: "me", userId: sam }, mikey), sam);
  assert.equal(reminderRecipient({ forWhom: "assignee", userId: sam }, mikey), mikey);
  assert.equal(reminderRecipient({ forWhom: "assignee", userId: sam }, null), sam, "no one has it: its setter");
  assert.deepEqual(carriedTiming({ at: null, daysBefore: 2, time: "09:00" }, "2026-11-30", "2026-12-07", ZONE), { at: null, daysBefore: 2, time: "09:00" });
  assert.deepEqual(carriedTiming({ at: "2026-11-29T14:00:00Z", daysBefore: null, time: null }, "2026-11-30", "2026-12-07", ZONE), { at: "2026-12-06T14:00:00Z", daysBefore: null, time: null });
  assert.equal(carriedTiming({ at: "2026-11-29T14:00:00Z", daysBefore: null, time: null }, null, "2026-12-07", ZONE), null);
  assert.equal(carriedTiming({ at: "2027-03-06T14:00:00Z", daysBefore: null, time: null }, "2027-03-07", "2027-03-21", ZONE)?.at, "2027-03-20T13:00:00Z", "9 AM before and after the clocks change");
});

test("reminders in words", () => {
  assert.equal(reminderText({ at: "2026-11-25T14:30:00Z", daysBefore: null, time: null }, ZONE), "Wed, Nov 25 at 9:30 AM");
  assert.equal(reminderText({ at: null, daysBefore: 0, time: "08:00" }, ZONE), "The day it's due, at 8:00 AM");
  assert.equal(reminderText({ at: null, daysBefore: 1, time: "16:30" }, ZONE), "The day before it's due, at 4:30 PM");
  assert.equal(reminderText({ at: null, daysBefore: 3, time: "09:00" }, ZONE), "3 days before it's due, at 9:00 AM");
});

test("when a notice is emailed: right away, in the morning digest, never, and never in quiet hours", async () => {
  const { DEFAULT_PREFERENCES, DIGEST_HOUR, emailDecision, isQuiet, readPreferences } = await import("./notice.ts");
  assert.equal(emailDecision(DEFAULT_PREFERENCES, "assigned", 14), "send");
  const prefs = { modes: { assigned: "daily", mentioned: "now", reminder: "never" }, quiet: { from: 21, to: 7 } } as const;
  assert.equal(emailDecision(prefs, "assigned", 14), "hold");
  assert.equal(emailDecision(prefs, "assigned", DIGEST_HOUR), "send");
  assert.equal(emailDecision(prefs, "reminder", 14), "skip");
  assert.equal(emailDecision(prefs, "mentioned", 23), "hold", "quiet");
  assert.equal(emailDecision(prefs, "mentioned", 3), "hold", "quiet across midnight");
  assert.equal(isQuiet({ from: 21, to: 7 }, 7), false, "the end hour isn't quiet");
  assert.equal(isQuiet({ from: 12, to: 13 }, 12), true);
  assert.deepEqual(readPreferences({ modes: { assigned: "daily" }, quietFrom: "", quietTo: "" }), { ok: true, value: { modes: { assigned: "daily", mentioned: "now", reminder: "now" }, quiet: null } });
  assert.equal(readPreferences({ modes: { assigned: "weekly" }, quietFrom: "", quietTo: "" }).ok, false);
  assert.equal(readPreferences({ modes: {}, quietFrom: "21", quietTo: "" }).ok, false);
  assert.equal(readPreferences({ modes: {}, quietFrom: "9", quietTo: "9" }).ok, false);
  assert.equal(readPreferences({ modes: {}, quietFrom: "24", quietTo: "7" }).ok, false);
});
