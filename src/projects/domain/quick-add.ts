// Quick add (decision 0007, section 4): one line of text, read into a task.
// The words that set a field are taken out of the title:
//
//   today, tomorrow, fri, next fri, next week, next month, in 3 days,
//   dec 5, 12/5, 2026-12-05 (with "on", "by" or "due" before it, or not)
//                                                    the due date
//   *website      a label          @jayanti   who it's for
//   !high         the priority     +better-days   the project, or a client
//   every week, every 2 months, daily, weekly, monthly, yearly   a repeat
//
// Only the first of each kind counts (labels excepted: any number); later
// ones stay in the title. Every part has the index of its first word, and a
// part whose index is in `ignore` is left in the title, which is how a part
// is "removed" from what was understood. A repeat counts from the due date
// (section 7).
//
// Reading names (who is @sam, which project is +better-days) is the
// application's job; here a name is only a handle.
import { TASK_PRIORITIES, type TaskPriority } from "./task.ts";
import type { Repeat, RepeatUnit } from "./repeat.ts";

export type QuickPart =
  | { readonly kind: "due"; readonly index: number; readonly words: string; readonly on: string }
  | { readonly kind: "label"; readonly index: number; readonly words: string; readonly handle: string; /** As typed, for a new label. */ readonly name: string }
  | { readonly kind: "person"; readonly index: number; readonly words: string; readonly handle: string }
  | { readonly kind: "priority"; readonly index: number; readonly words: string; readonly priority: TaskPriority }
  | { readonly kind: "project"; readonly index: number; readonly words: string; readonly handle: string }
  | { readonly kind: "repeat"; readonly index: number; readonly words: string; readonly repeat: Repeat };

export type QuickParse = { readonly title: string; readonly parts: readonly QuickPart[] };

/** At most this many characters are read. */
export const QUICK_ADD_MAX = 300;

const WEEKDAYS: Record<string, number> = { mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7 };
const MONTHS: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const UNITS: Record<string, "days" | "weeks" | "months"> = { day: "days", days: "days", week: "weeks", weeks: "weeks", month: "months", months: "months" };
const LEAD_INS = new Set(["on", "by", "due"]);
const REPEAT_UNIT: Record<string, RepeatUnit> = { day: "day", days: "day", week: "week", weeks: "week", month: "month", months: "month", year: "year", years: "year" };
const REPEAT_WORDS: Record<string, RepeatUnit> = { daily: "day", weekly: "week", monthly: "month", yearly: "year", annually: "year" };

/** A repeat starting at words[i], and how many words it took. */
function repeatAt(words: readonly string[], i: number): { readonly repeat: Repeat; readonly length: number } | null {
  const a = word(words[i]);
  const b = word(words[i + 1]);
  const c = word(words[i + 2]);
  if (REPEAT_WORDS[a]) return { repeat: { every: 1, unit: REPEAT_WORDS[a] as RepeatUnit, from: "due" }, length: 1 };
  if (a !== "every") return null;
  if (REPEAT_UNIT[b] && !b.endsWith("s")) return { repeat: { every: 1, unit: REPEAT_UNIT[b] as RepeatUnit, from: "due" }, length: 2 };
  if (/^\d{1,3}$/.test(b) && REPEAT_UNIT[c]) {
    const every = Number(b);
    if (every >= 1 && every <= 365) return { repeat: { every, unit: REPEAT_UNIT[c] as RepeatUnit, from: "due" }, length: 3 };
  }
  if (b === "other" && REPEAT_UNIT[c] && !c.endsWith("s")) return { repeat: { every: 2, unit: REPEAT_UNIT[c] as RepeatUnit, from: "due" }, length: 3 };
  return null;
}
const HANDLE = /^([*@+])([\p{L}\p{N}][\p{L}\p{N}_.\-]*?)[.,;:]?$/u;
const PRIORITY = /^!([a-z]+)[.,;:]?$/;

/** A name as a handle: lower case, accents off, anything else a hyphen. "Better Days Towing" is "better-days-towing". */
export function handleOf(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

const word = (text: string | undefined) => (text ?? "").toLowerCase().replace(/[.,;:]$/, "");

/** A calendar date, or null if there is no such day. */
function dateOf(year: number, month: number, day: number): Temporal.PlainDate | null {
  try {
    return Temporal.PlainDate.from({ year, month, day }, { overflow: "reject" });
  } catch {
    return null;
  }
}

/** A month and day with no year is the next one: this year, or next year once it has passed. */
function nextOf(today: Temporal.PlainDate, month: number, day: number): Temporal.PlainDate | null {
  const thisYear = dateOf(today.year, month, day);
  if (thisYear && Temporal.PlainDate.compare(thisYear, today) >= 0) return thisYear;
  return dateOf(today.year + 1, month, day);
}

/** The next such weekday after today: on a Friday, "fri" is a week away. */
function nextWeekday(today: Temporal.PlainDate, weekday: number): Temporal.PlainDate {
  return today.add({ days: ((weekday - today.dayOfWeek + 6) % 7) + 1 });
}

/** A date starting at words[i], and how many words it took. */
function dateAt(words: readonly string[], i: number, today: Temporal.PlainDate): { readonly on: Temporal.PlainDate; readonly length: number } | null {
  const a = word(words[i]);
  const b = word(words[i + 1]);
  const c = word(words[i + 2]);
  if (a === "today") return { on: today, length: 1 };
  if (a === "tomorrow") return { on: today.add({ days: 1 }), length: 1 };
  if (a === "next" && b === "week") return { on: today.add({ days: 8 - today.dayOfWeek }), length: 2 };
  if (a === "next" && b === "month") return { on: today.with({ day: 1 }).add({ months: 1 }), length: 2 };
  if (a === "next" && WEEKDAYS[b] !== undefined) return { on: today.add({ days: 8 - today.dayOfWeek + (WEEKDAYS[b] as number) - 1 }), length: 2 };
  if (WEEKDAYS[a] !== undefined) return { on: nextWeekday(today, WEEKDAYS[a] as number), length: 1 };
  if (a === "in" && /^\d{1,3}$/.test(b) && UNITS[c] !== undefined) {
    const amount = Number(b);
    if (amount > 0) return { on: today.add({ [UNITS[c] as string]: amount }), length: 3 };
  }
  if (MONTHS[a] !== undefined && /^\d{1,2}(st|nd|rd|th)?$/.test(b)) {
    const on = nextOf(today, MONTHS[a] as number, Number.parseInt(b, 10));
    if (on) return { on, length: 2 };
  }
  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(a);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    const on = slash[3] ? dateOf(Number(slash[3]), month, day) : nextOf(today, month, day);
    if (on) return { on, length: 1 };
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a);
  if (iso) {
    const on = dateOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (on) return { on, length: 1 };
  }
  return null;
}

const isPriority = (value: string): value is TaskPriority => (TASK_PRIORITIES as readonly string[]).includes(value);

/** Reads one line of quick add. `today` is YYYY-MM-DD in the business time zone. */
export function parseQuickAdd(text: string, today: string, ignore: ReadonlySet<number> = new Set()): QuickParse {
  const words = text.slice(0, QUICK_ADD_MAX).trim().split(/\s+/).filter(Boolean);
  const day = Temporal.PlainDate.from(today);
  const parts: QuickPart[] = [];
  const title: string[] = [];
  const has = (kind: QuickPart["kind"]) => parts.some((part) => part.kind === kind);
  const labels = new Set<string>();
  let i = 0;
  while (i < words.length) {
    const here = words[i] as string;
    if (ignore.has(i)) {
      title.push(here);
      i += 1;
      continue;
    }
    if (!has("due")) {
      const leadIn = LEAD_INS.has(word(here)) && !ignore.has(i + 1) ? dateAt(words, i + 1, day) : null;
      const date = leadIn ? { on: leadIn.on, length: leadIn.length + 1 } : dateAt(words, i, day);
      if (date) {
        parts.push({ kind: "due", index: i, words: words.slice(i, i + date.length).join(" "), on: date.on.toString() });
        i += date.length;
        continue;
      }
    }
    if (!has("repeat")) {
      const repeat = repeatAt(words, i);
      if (repeat) {
        parts.push({ kind: "repeat", index: i, words: words.slice(i, i + repeat.length).join(" "), repeat: repeat.repeat });
        i += repeat.length;
        continue;
      }
    }
    const priority = PRIORITY.exec(here.toLowerCase());
    if (priority && isPriority(priority[1] as string) && !has("priority")) {
      parts.push({ kind: "priority", index: i, words: here, priority: priority[1] as TaskPriority });
      i += 1;
      continue;
    }
    const handle = HANDLE.exec(here);
    if (handle) {
      const sign = handle[1];
      const name = handleOf(handle[2] as string);
      if (name && sign === "*" && !labels.has(name)) {
        labels.add(name);
        parts.push({ kind: "label", index: i, words: here, handle: name, name: handle[2] as string });
        i += 1;
        continue;
      }
      if (name && sign === "@" && !has("person")) {
        parts.push({ kind: "person", index: i, words: here, handle: name });
        i += 1;
        continue;
      }
      if (name && sign === "+" && !has("project")) {
        parts.push({ kind: "project", index: i, words: here, handle: name });
        i += 1;
        continue;
      }
    }
    title.push(here);
    i += 1;
  }
  return { title: title.join(" "), parts };
}

/** Which of several named things a handle means: an exact handle first, then one whose handle starts with it as whole words. */
export function matchHandle<T>(handle: string, things: readonly T[], namesOf: (thing: T) => readonly string[]): readonly T[] {
  const exact = things.filter((thing) => namesOf(thing).some((name) => handleOf(name) === handle));
  if (exact.length > 0) return exact;
  return things.filter((thing) => namesOf(thing).some((name) => handleOf(name).startsWith(handle + "-")));
}
