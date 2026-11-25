// A call in progress (decision 0009, call mode): when it started, how long
// it's planned to last, and when to start wrapping up. Pure rules, tested
// with nothing installed; the clock is always passed in.
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

/** A call that wasn't booked is planned for this long. Confirmed by Mikey: most calls are 30 minutes (decision 0009, section 1). */
export const DEFAULT_CALL_MINUTES = 30;
/** One tap sets these, for a call picked up with only 15 minutes to give, or one that runs long. */
export const QUICK_CALL_MINUTES = [15, 30, 45, 60] as const;
export const MIN_CALL_MINUTES = 5;
export const MAX_CALL_MINUTES = 240;
/** The planned length changes in steps of this many minutes. */
export const CALL_STEP_MINUTES = 5;
/** A call left open this long is ended by HQ. Confirmed by Mikey (decision 0009, section 4). */
export const AUTO_END_MINUTES = 180;

export type Call = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly contactId: Id | null;
  readonly opportunityId: Id | null;
  readonly bookingId: Id | null;
  readonly userId: Id;
  readonly phone: string;
  readonly startedAt: string;
  readonly plannedMinutes: number;
  readonly warnMinutes: number;
  readonly note: string;
  readonly endedAt: string | null;
  readonly touchId: Id | null;
  /** The guide on the screen: a situation from call-guide.ts, or null before guides (migration 0053). */
  readonly guide: string | null;
  /** Where ending the call goes: the list it was started from, or null for the client's call log. */
  readonly returnTo: string | null;
};

export type CallError = "invalid-length" | "call-ended" | "note-too-long";

/**
 * When to start wrapping up, in minutes before the planned end: 5, or a
 * third of a call shorter than 15 minutes (3 for a 10-minute call).
 * Default to confirm (decision 0009, section 3).
 */
export function warnMinutesFor(plannedMinutes: number): number {
  return plannedMinutes >= 15 ? 5 : Math.max(1, Math.round(plannedMinutes / 3));
}

/** A booked call's length, kept within what a call may be and rounded to the step. */
export function plannedFromBooking(startsAt: string, endsAt: string): number {
  const minutes = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000);
  if (!Number.isFinite(minutes)) return DEFAULT_CALL_MINUTES;
  const stepped = Math.round(minutes / CALL_STEP_MINUTES) * CALL_STEP_MINUTES;
  return Math.min(MAX_CALL_MINUTES, Math.max(MIN_CALL_MINUTES, stepped));
}

export function startCall(ids: Pick<Call, "id" | "organizationId" | "contactId" | "opportunityId" | "bookingId" | "userId" | "phone" | "startedAt">, plannedMinutes: number = DEFAULT_CALL_MINUTES, guide: string | null = null): Result<Call, "invalid-length"> {
  if (!validLength(plannedMinutes)) return err("invalid-length");
  return ok({ ...ids, plannedMinutes, warnMinutes: warnMinutesFor(plannedMinutes), note: "", endedAt: null, touchId: null, guide, returnTo: null });
}

const validLength = (minutes: number) => Number.isInteger(minutes) && minutes >= MIN_CALL_MINUTES && minutes <= MAX_CALL_MINUTES && minutes % CALL_STEP_MINUTES === 0;

/** Longer or shorter by `steps` of 5 minutes. The warning moves with it. */
export function changeLength(call: Call, steps: number): Result<Call, CallError> {
  if (!Number.isInteger(steps) || steps === 0) return err("invalid-length");
  return setLength(call, call.plannedMinutes + steps * CALL_STEP_MINUTES);
}

/** Planned for exactly this many minutes, like 15 for a call picked up with only that to give. */
export function setLength(call: Call, minutes: number): Result<Call, CallError> {
  if (call.endedAt !== null) return err("call-ended");
  if (!validLength(minutes)) return err("invalid-length");
  return ok({ ...call, plannedMinutes: minutes, warnMinutes: warnMinutesFor(minutes) });
}

export function keepNote(call: Call, note: string): Result<Call, CallError> {
  if (call.endedAt !== null) return err("call-ended");
  if (note.length > 2000) return err("note-too-long");
  return ok({ ...call, note });
}

export type CallPhase = "on" | "wrap-up" | "over";

export type CallClock = {
  readonly phase: CallPhase;
  /** Whole seconds since it started. */
  readonly elapsed: number;
  /** Whole seconds to the planned end; negative once it's over. */
  readonly left: number;
  /** The instant to start wrapping up, and the planned end. */
  readonly wrapUpAt: string;
  readonly endsAt: string;
};

/** Where a call stands at `now`. */
export function callClock(call: Pick<Call, "startedAt" | "plannedMinutes" | "warnMinutes" | "endedAt">, now: string): CallClock {
  const start = Date.parse(call.startedAt);
  const at = Date.parse(call.endedAt ?? now);
  const end = start + call.plannedMinutes * 60_000;
  const wrap = end - call.warnMinutes * 60_000;
  const elapsed = Math.max(0, Math.floor((at - start) / 1000));
  const left = Math.ceil((end - at) / 1000);
  const phase: CallPhase = at >= end ? "over" : at >= wrap ? "wrap-up" : "on";
  return { phase, elapsed, left, wrapUpAt: new Date(wrap).toISOString(), endsAt: new Date(end).toISOString() };
}

/** The length the call log records: whole minutes, at least 1, at most a day. */
export function loggedMinutes(startedAt: string, endedAt: string): number {
  const minutes = Math.ceil((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000);
  return Math.min(1440, Math.max(1, minutes));
}

/** True when HQ should end a call nobody ended. */
export function forgotten(call: Pick<Call, "startedAt" | "endedAt">, now: string): boolean {
  return call.endedAt === null && Date.parse(now) - Date.parse(call.startedAt) >= AUTO_END_MINUTES * 60_000;
}

/** "4:05", "1:02:09": a timer as it reads. */
export function timerText(seconds: number): string {
  const whole = Math.abs(Math.trunc(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "14 min", "1 h 5 min": a logged call's length. */
export function lengthText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** After a voicemail or no answer, try again this many business days later. Default to confirm (decision 0009, section 5). */
export const RETRY_BUSINESS_DAYS = 2;
/** An invoice this many days late is worth a call. Default to confirm (decision 0009, section 5). */
export const OVERDUE_CALL_DAYS = 7;

/** `days` business days after `day`, skipping Saturdays and Sundays: Friday plus 2 is Tuesday. */
export function addBusinessDays(day: string, days: number): string {
  let date = Temporal.PlainDate.from(day);
  let left = days;
  while (left > 0) {
    date = date.add({ days: 1 });
    if (date.dayOfWeek <= 5) left -= 1;
  }
  return date.toString();
}

/**
 * The voicemail script with its blanks filled: {name} is their first name,
 * {me} yours, {about} what the call is about. A blank with nothing to fill it
 * is said plainly ("there", "your project").
 */
export function fillScript(script: string, blanks: { readonly name: string; readonly me: string; readonly about: string }): string {
  const first = (full: string) => full.trim().split(/\s+/)[0] ?? "";
  return script.replace(/\{(name|me|about)\}/g, (_, key: string) => (key === "name" ? first(blanks.name) || "there" : key === "me" ? first(blanks.me) || "me" : blanks.about.trim() || "your project"));
}

/** Where a call goes back to when it ends: a path in HQ, never another site. */
export function readReturnTo(text: string | null | undefined): string | null {
  const to = (text ?? "").trim();
  return /^\/(?![\/\\])[\x21-\x7e]{0,199}$/.test(to) ? to : null;
}
