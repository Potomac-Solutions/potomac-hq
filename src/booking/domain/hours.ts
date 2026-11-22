// Booking: the hours Potomac takes calls, and the open times they leave.
// Pure rules on Temporal values. Instants are ISO 8601 text in UTC; days and
// times of day are read in the business's own time zone.
import { err, ok, type Result } from "../../shared/domain/result.ts";

/** Monday is 1 and Sunday is 7, as in Temporal. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A stretch of a weekday, in minutes after midnight: 9:00 to 12:00 is 540 to 720. */
export type HoursRange = { readonly weekday: Weekday; readonly start: number; readonly end: number };

export type BookingRules = {
  readonly callMinutes: number;
  /** Kept free after each call. */
  readonly gapMinutes: number;
  /** How soon the first open time can be. */
  readonly noticeHours: number;
  readonly daysAhead: number;
  readonly hours: readonly HoursRange[];
  /** Days with no calls, like "2026-12-25". */
  readonly closedDays: readonly string[];
};

/** A time that is already taken: a booked call, or busy in a calendar. */
export type Busy = { readonly start: string; readonly end: string };

export const CALL_LENGTHS = [15, 20, 30, 45, 60, 90] as const;
export const WEEKDAY_NAMES: Readonly<Record<Weekday, string>> = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday" };
const MAX_RANGES_PER_DAY = 3;

export const DEFAULT_RULES: BookingRules = {
  callMinutes: 30,
  gapMinutes: 15,
  noticeHours: 24,
  daysAhead: 21,
  hours: [],
  closedDays: [],
};

export type RulesError = "call-length" | "gap" | "notice" | "days-ahead" | "hours-invalid" | "hours-overlap" | "hours-too-many";

/** Checks rules an admin or manager typed. */
export function checkRules(rules: BookingRules): Result<BookingRules, RulesError> {
  if (!(CALL_LENGTHS as readonly number[]).includes(rules.callMinutes)) return err("call-length");
  if (!Number.isInteger(rules.gapMinutes) || rules.gapMinutes < 0 || rules.gapMinutes > 60) return err("gap");
  if (!Number.isInteger(rules.noticeHours) || rules.noticeHours < 0 || rules.noticeHours > 168) return err("notice");
  if (!Number.isInteger(rules.daysAhead) || rules.daysAhead < 1 || rules.daysAhead > 90) return err("days-ahead");
  for (const range of rules.hours) {
    const whole = Number.isInteger(range.start) && Number.isInteger(range.end) && range.weekday >= 1 && range.weekday <= 7;
    if (!whole || range.start < 0 || range.end > 24 * 60 || range.end - range.start < rules.callMinutes) return err("hours-invalid");
  }
  for (let day = 1; day <= 7; day++) {
    const ranges = rules.hours.filter((range) => range.weekday === day).toSorted((a, b) => a.start - b.start);
    if (ranges.length > MAX_RANGES_PER_DAY) return err("hours-too-many");
    for (let i = 1; i < ranges.length; i++) if ((ranges[i] as HoursRange).start < (ranges[i - 1] as HoursRange).end) return err("hours-overlap");
  }
  return ok(rules);
}

/** "9:00" or "17:30" → minutes after midnight. Null when it is not a time. */
export function parseClock(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null;
  return hours * 60 + minutes;
}

/** 540 → "09:00", for a time field. */
export function clockValue(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 540 → "9:00 AM", 780 → "1:00 PM", 0 → "12:00 AM". */
export function clockLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

export type OpenDay = { readonly day: string; readonly slots: readonly { readonly start: string; readonly end: string; readonly label: string }[] };

/**
 * The open times from now: inside the hours, not on a closed day, at least
 * the notice away, and clear of every busy time by the gap. Times start at
 * the beginning of each range, one call and one gap apart.
 */
export function openSlots(rules: BookingRules, busy: readonly Busy[], now: string, timeZone: string): readonly OpenDay[] {
  const nowInstant = Temporal.Instant.from(now);
  const earliest = nowInstant.add({ minutes: rules.noticeHours * 60 });
  const today = nowInstant.toZonedDateTimeISO(timeZone).toPlainDate();
  const gapMs = rules.gapMinutes * 60_000;
  const taken = busy.map((one) => ({ start: Temporal.Instant.from(one.start).epochMilliseconds - gapMs, end: Temporal.Instant.from(one.end).epochMilliseconds + gapMs }));
  const closed = new Set(rules.closedDays);
  const days: OpenDay[] = [];
  for (let offset = 0; offset <= rules.daysAhead; offset++) {
    const date = today.add({ days: offset });
    const day = date.toString();
    if (closed.has(day)) continue;
    const slots: { start: string; end: string; label: string }[] = [];
    for (const range of rules.hours.filter((one) => one.weekday === date.dayOfWeek).toSorted((a, b) => a.start - b.start)) {
      for (let at = range.start; at + rules.callMinutes <= range.end; at += rules.callMinutes + rules.gapMinutes) {
        const wall = date.toPlainDateTime({ hour: Math.floor(at / 60), minute: at % 60 });
        const zoned = wall.toZonedDateTime(timeZone, { disambiguation: "earlier" });
        // A time the clocks skip in spring does not exist that day: no call then.
        if (!zoned.toPlainDateTime().equals(wall)) continue;
        const start = zoned.toInstant();
        if (Temporal.Instant.compare(start, earliest) < 0) continue;
        const end = start.add({ minutes: rules.callMinutes });
        const startMs = start.epochMilliseconds;
        const endMs = end.epochMilliseconds;
        if (taken.some((one) => startMs < one.end && endMs > one.start)) continue;
        slots.push({ start: start.toString(), end: end.toString(), label: clockLabel(at) });
      }
    }
    if (slots.length > 0) days.push({ day, slots });
  }
  return days;
}

/** Whether this exact time is open: what a booking checks just before it is saved. */
export function isOpen(rules: BookingRules, busy: readonly Busy[], now: string, timeZone: string, start: string): { readonly end: string } | null {
  for (const day of openSlots(rules, busy, now, timeZone)) {
    const slot = day.slots.find((one) => Temporal.Instant.compare(one.start, start) === 0);
    if (slot) return { end: slot.end };
  }
  return null;
}

/** "Mondays 9:00 AM to 12:00 PM, 1:00 PM to 5:00 PM" lines, for showing the hours. */
export function hoursSummary(hours: readonly HoursRange[]): readonly { readonly weekday: Weekday; readonly name: string; readonly text: string }[] {
  const lines: { weekday: Weekday; name: string; text: string }[] = [];
  for (let day = 1 as Weekday; day <= 7; day = (day + 1) as Weekday) {
    const ranges = hours.filter((range) => range.weekday === day).toSorted((a, b) => a.start - b.start);
    lines.push({ weekday: day, name: WEEKDAY_NAMES[day], text: ranges.length === 0 ? "No calls" : ranges.map((range) => `${clockLabel(range.start)} to ${clockLabel(range.end)}`).join(", ") });
  }
  return lines;
}
