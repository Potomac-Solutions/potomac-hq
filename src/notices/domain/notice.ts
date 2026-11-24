// Notices (decision 0007, section 8): what's new for one person, under the
// bell in the header and on Today. Three things make one:
//
//   assigned    a task or to-do was given to you by someone else
//   mentioned   someone @mentioned you in a comment
//   reminder    a reminder you set on a task came due
//
// Assignments and mentions are read from the events the projects and todos
// modules already record, so nothing is told twice and nothing is missed.
// Your own actions never make a notice for you.
import type { Id } from "../../shared/domain/id.ts";

export const NOTICE_KINDS = ["assigned", "mentioned", "reminder"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export type Notice = {
  readonly id: Id;
  readonly userId: Id;
  readonly kind: NoticeKind;
  readonly taskId: Id;
  /** Who did it. Null for a reminder. */
  readonly actorId: Id | null;
  /** A comment's first words, or empty. */
  readonly detail: string;
  readonly createdAt: string;
  readonly readAt: string | null;
};

export type NoticeDraft = Pick<Notice, "userId" | "kind" | "taskId" | "actorId" | "detail">;

/** The parts of an activity event a notice is read from. */
export type NoticeEvent = {
  readonly actorId: Id | null;
  readonly action: string;
  readonly recordId: Id;
  readonly context: Readonly<Record<string, unknown>>;
};

const DETAIL_MAX = 140;

/** A comment's first words, cut at a word. */
export function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= DETAIL_MAX) return flat;
  const cut = flat.slice(0, DETAIL_MAX);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 80 ? cut.lastIndexOf(" ") : DETAIL_MAX)}…`;
}

const idOf = (value: unknown): Id | null => (typeof value === "string" && value !== "" ? (value as Id) : null);
const idsOf = (value: unknown): Id[] => (Array.isArray(value) ? value.filter((one): one is Id => typeof one === "string" && one !== "") : []);

/** The notices an event makes. A repeat's next task isn't news: it goes to whoever had the last one. */
export function noticesFromEvent(event: NoticeEvent): NoticeDraft[] {
  const actorId = event.actorId;
  const notFromThem = (userId: Id | null): userId is Id => userId !== null && userId !== actorId;
  const taskId = event.recordId;
  switch (event.action) {
    case "task.added":
    case "todo.added": {
      const to = idOf(event.context["assigneeId"]);
      return notFromThem(to) ? [{ userId: to, kind: "assigned", taskId, actorId, detail: "" }] : [];
    }
    case "task.edited": {
      const to = idOf(event.context["assigneeId"]);
      const was = idOf(event.context["assigneeWas"]);
      return notFromThem(to) && to !== was ? [{ userId: to, kind: "assigned", taskId, actorId, detail: "" }] : [];
    }
    case "comment.added":
    case "comment.edited": {
      const detail = snippet(String(event.context["body"] ?? ""));
      return idsOf(event.context["mentions"])
        .filter(notFromThem)
        .map((userId) => ({ userId, kind: "mentioned" as const, taskId, actorId, detail }));
    }
    default:
      return [];
  }
}

/**
 * A reminder on a task. Either at a time, or a number of days before the task
 * is due, at a time of day in the business time zone. One before the due date
 * fires again if the due date moves.
 *
 * It is for the person who set it ("me"), or for whoever has the task when it
 * fires ("assignee"), or its setter when no one has it. A reminder may carry
 * over to the next task when a repeating task is finished.
 */
export type Reminder = {
  readonly id: Id;
  readonly taskId: Id;
  readonly userId: Id;
  /** A UTC instant, for one at a time. */
  readonly at: string | null;
  /** For one before the due date: 0 is the day it's due. */
  readonly daysBefore: number | null;
  /** For one before the due date: HH:MM. */
  readonly time: string | null;
  readonly forWhom: ReminderFor;
  /** Copied to the next task when this one repeats. */
  readonly carry: boolean;
  /** When it last fired, and for which due date. */
  readonly sentAt: string | null;
  readonly sentForDue: string | null;
};

export const DAYS_BEFORE_MAX = 30;
export const REMINDER_FOR = ["me", "assignee"] as const;
export type ReminderFor = (typeof REMINDER_FOR)[number];

/** Who a reminder tells when it fires. */
export const reminderRecipient = (reminder: Pick<Reminder, "forWhom" | "userId">, assigneeId: Id | null): Id => (reminder.forWhom === "assignee" && assigneeId ? assigneeId : reminder.userId);

export type ReminderError = "invalid-reminder" | "reminder-in-the-past";

export type ReminderInput = (
  | { readonly kind: "at"; readonly when: string }
  | { readonly kind: "before"; readonly daysBefore: string; readonly time: string }
) & { readonly forWhom?: string; readonly carry?: boolean };

/** Reads a reminder from the form. `when` is a local date and time, as a datetime-local field sends it. */
export function readReminder(
  input: ReminderInput,
  zone: string,
  now: Temporal.Instant,
): { ok: true; value: Pick<Reminder, "at" | "daysBefore" | "time" | "forWhom" | "carry"> } | { ok: false; error: ReminderError } {
  const forWhom = (input.forWhom || "me") as ReminderFor;
  if (!REMINDER_FOR.includes(forWhom)) return { ok: false, error: "invalid-reminder" };
  const carry = input.carry === true;
  if (input.kind === "at") {
    let at: Temporal.Instant;
    try {
      at = Temporal.PlainDateTime.from(input.when.trim(), { overflow: "reject" }).toZonedDateTime(zone).toInstant();
    } catch {
      return { ok: false, error: "invalid-reminder" };
    }
    if (Temporal.Instant.compare(at, now) <= 0) return { ok: false, error: "reminder-in-the-past" };
    return { ok: true, value: { at: at.toString(), daysBefore: null, time: null, forWhom, carry } };
  }
  const days = Number(input.daysBefore.trim() || "0");
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time.trim()) ? input.time.trim() : null;
  if (!Number.isInteger(days) || days < 0 || days > DAYS_BEFORE_MAX || time === null) return { ok: false, error: "invalid-reminder" };
  return { ok: true, value: { at: null, daysBefore: days, time, forWhom, carry } };
}

/**
 * The timing a carried reminder gets on the next task. One before the due
 * date stays as it is. One at a time moves as many days as the due date did;
 * with no due date to measure by, it isn't carried.
 */
export function carriedTiming(reminder: Pick<Reminder, "at" | "daysBefore" | "time">, oldDue: string | null, newDue: string | null, zone: string): Pick<Reminder, "at" | "daysBefore" | "time"> | null {
  if (!reminder.at) return { at: null, daysBefore: reminder.daysBefore, time: reminder.time };
  if (oldDue === null || newDue === null) return null;
  const days = Temporal.PlainDate.from(oldDue).until(Temporal.PlainDate.from(newDue), { largestUnit: "days" }).days;
  // In the business time zone, so 9 AM stays 9 AM across a clock change.
  return { at: Temporal.Instant.from(reminder.at).toZonedDateTimeISO(zone).add({ days }).toInstant().toString(), daysBefore: null, time: null };
}

/** When a reminder fires, or null if it can't yet: one before a due date needs a due date. */
export function firesAt(reminder: Pick<Reminder, "at" | "daysBefore" | "time">, dueOn: string | null, zone: string): Temporal.Instant | null {
  if (reminder.at) return Temporal.Instant.from(reminder.at);
  if (dueOn === null || reminder.daysBefore === null || reminder.time === null) return null;
  const day = Temporal.PlainDate.from(dueOn).subtract({ days: reminder.daysBefore });
  return day.toPlainDateTime(Temporal.PlainTime.from(reminder.time)).toZonedDateTime(zone).toInstant();
}

/** Whether it should fire now. A task that's done reminds no one. */
export function isReminderDue(reminder: Reminder, task: { readonly dueOn: string | null; readonly done: boolean }, now: Temporal.Instant, zone: string): boolean {
  if (task.done) return false;
  const when = firesAt(reminder, task.dueOn, zone);
  if (!when || Temporal.Instant.compare(when, now) > 0) return false;
  return reminder.at ? reminder.sentAt === null : reminder.sentForDue !== task.dueOn;
}

const clock = (time: Temporal.PlainTime) => time.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });

/** "Tue, Dec 1 at 9:00 AM", or "2 days before it's due, at 9:00 AM". */
export function reminderText(reminder: Pick<Reminder, "at" | "daysBefore" | "time">, zone: string): string {
  if (reminder.at) {
    const local = Temporal.Instant.from(reminder.at).toZonedDateTimeISO(zone);
    return `${local.toPlainDate().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${clock(local.toPlainTime())}`;
  }
  const time = clock(Temporal.PlainTime.from(reminder.time ?? "09:00"));
  const days = reminder.daysBefore ?? 0;
  if (days === 0) return `The day it's due, at ${time}`;
  return `${days === 1 ? "The day before" : `${days} days before`} it's due, at ${time}`;
}
