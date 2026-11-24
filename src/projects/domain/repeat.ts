// Repeating tasks (decision 0007, section 7). A task may repeat every N days,
// weeks, months or years, counted from its due date or from the day it was
// done. Finishing it makes the next one.
//
// Counted from the due date, the next due date is the first one after the day
// it was done: a weekly report due Monday and done three weeks late is next
// due the coming Monday, not three Mondays ago. With no due date, it counts
// from the day it was done.
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const REPEAT_UNITS = ["day", "week", "month", "year"] as const;
export type RepeatUnit = (typeof REPEAT_UNITS)[number];
export const REPEAT_FROM = ["due", "done"] as const;
export type RepeatFrom = (typeof REPEAT_FROM)[number];

export type Repeat = { readonly every: number; readonly unit: RepeatUnit; readonly from: RepeatFrom };

export const REPEAT_MAX = 365;

export type RepeatError = "invalid-repeat";

/** Reads a repeat from a form: how many, which unit, and counted from which day. */
export function readRepeat(input: { readonly every?: string | null; readonly unit?: string | null; readonly from?: string | null }): Result<Repeat, RepeatError> {
  const every = Number((input.every ?? "1").trim() || "1");
  const unit = (input.unit ?? "") as RepeatUnit;
  const from = ((input.from ?? "") || "due") as RepeatFrom;
  if (!Number.isInteger(every) || every < 1 || every > REPEAT_MAX) return err("invalid-repeat");
  if (!REPEAT_UNITS.includes(unit) || !REPEAT_FROM.includes(from)) return err("invalid-repeat");
  return ok({ every, unit, from });
}

const add = (day: Temporal.PlainDate, repeat: Repeat) => day.add({ [`${repeat.unit}s`]: repeat.every }, { overflow: "constrain" });

/** The next due date, YYYY-MM-DD, for a task finished on `doneOn`. */
export function nextDue(repeat: Repeat, dueOn: string | null, doneOn: string): string {
  const done = Temporal.PlainDate.from(doneOn);
  if (repeat.from === "done" || dueOn === null) return add(done, repeat).toString();
  // From the due date: step until it's after the day it was done. Months keep
  // their day where they can (Jan 31, Feb 28, Mar 31), so count each step from the start.
  const start = Temporal.PlainDate.from(dueOn);
  for (let steps = 1; ; steps += 1) {
    const next = start.add({ [`${repeat.unit}s`]: repeat.every * steps }, { overflow: "constrain" });
    if (Temporal.PlainDate.compare(next, done) > 0) return next.toString();
  }
}

/** How far a date moves between one task and the next, to move its subtasks' dates the same way. */
export function shiftBy(from: string | null, to: string, day: string | null): string | null {
  if (day === null || from === null) return null;
  const days = Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), { largestUnit: "days" }).days;
  return Temporal.PlainDate.from(day).add({ days }).toString();
}

const UNIT_WORDS: Record<RepeatUnit, [string, string]> = { day: ["day", "days"], week: ["week", "weeks"], month: ["month", "months"], year: ["year", "years"] };

/** "Every 2 weeks, from the due date". */
export function repeatText(repeat: Repeat | null): string {
  if (!repeat) return "";
  const [one, many] = UNIT_WORDS[repeat.unit];
  const every = repeat.every === 1 ? `Every ${one}` : `Every ${repeat.every} ${many}`;
  return `${every}, ${repeat.from === "due" ? "from the due date" : "from the day it’s done"}`;
}
