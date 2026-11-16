// Time worked on a project, and optionally on one of its tasks (roadmap
// v0.5). An entry is either typed in afterwards or made by the timer, which
// starts when a task is marked "working on" (docs/workflow.md, B6).
import { calendarDate, optionalText } from "../../shared/domain/fields.ts";
import { parseHours } from "../../shared/domain/hours.ts";
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type TimeEntry = {
  readonly id: Id;
  readonly projectId: Id;
  readonly taskId: Id | null;
  readonly userId: Id;
  /** The day it counts for, YYYY-MM-DD in the business time zone. */
  readonly workedOn: string;
  /** Whole minutes. Null while the timer is still running. */
  readonly minutes: number | null;
  readonly note: string;
  readonly billable: boolean;
  /** When the timer started, for entries the timer made. */
  readonly startedAt: string | null;
};

export type TimeInput = { readonly on: string; readonly hours: string; readonly note?: string | null; readonly billable?: boolean };
export type TimeError = "invalid-date" | "date-in-future" | "invalid-hours" | "hours-missing" | "too-long-for-a-day" | "note-too-long";

export const isRunning = (entry: TimeEntry): boolean => entry.minutes === null;

/** An entry typed in afterwards: a day, some hours, and a note. */
export function logEntry(ids: { readonly id: Id; readonly projectId: Id; readonly taskId: Id | null; readonly userId: Id }, input: TimeInput, today: string): Result<TimeEntry, TimeError> {
  const on = calendarDate(input.on.trim());
  if (!on.ok) return on;
  if (on.value > today) return err("date-in-future");
  const minutes = parseHours(input.hours);
  if (!minutes.ok) return minutes;
  if (minutes.value === null || minutes.value === 0) return err("hours-missing");
  if (minutes.value > 24 * 60) return err("too-long-for-a-day");
  const note = optionalText(input.note, 500);
  if (!note.ok) return err("note-too-long");
  return ok({ ...ids, workedOn: on.value, minutes: minutes.value, note: note.value ?? "", billable: input.billable ?? true, startedAt: null });
}

/** A timer started now. It counts for today until it is stopped. */
export function startEntry(ids: { readonly id: Id; readonly projectId: Id; readonly taskId: Id | null; readonly userId: Id }, at: string, today: string): TimeEntry {
  return { ...ids, workedOn: today, minutes: null, note: "", billable: true, startedAt: at };
}

/** A timer left running overnight is capped, so one forgotten click cannot log days. */
export const MAX_TIMER_MINUTES = 12 * 60;

/** Stops a running timer. Time is rounded up to the minute, and never less than one. */
export function stopEntry(entry: TimeEntry, at: string): Result<TimeEntry, "not-running"> {
  if (entry.minutes !== null || entry.startedAt === null) return err("not-running");
  const elapsed = Temporal.Instant.from(at).since(Temporal.Instant.from(entry.startedAt)).total("minutes");
  return ok({ ...entry, minutes: Math.min(MAX_TIMER_MINUTES, Math.max(1, Math.ceil(elapsed))) });
}

/** The Monday that starts the week a day is in, and the Sunday that ends it. */
export function weekOf(day: string): { readonly from: string; readonly to: string } {
  const date = Temporal.PlainDate.from(day);
  const monday = date.subtract({ days: date.dayOfWeek - 1 });
  return { from: monday.toString(), to: monday.add({ days: 6 }).toString() };
}
