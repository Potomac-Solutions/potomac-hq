// A scheduling invite: Potomac asks someone to paint the half hours they
// could do over a few days, within Potomac's own free time, then confirms
// one, which books the call. Like a Timeful poll with two people.
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";
import { CALL_LENGTHS } from "./hours.ts";

export type InviteStatus = "open" | "confirmed" | "cancelled";
export const INVITE_STATUS_LABELS: Readonly<Record<InviteStatus, string>> = { open: "Waiting for times", confirmed: "Booked", cancelled: "Cancelled" };

export type ScheduleInvite = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly clientUserId: Id;
  readonly title: string;
  readonly minutes: number;
  /** The days they can choose from, YYYY-MM-DD, inclusive. */
  readonly firstDay: string;
  readonly lastDay: string;
  readonly note: string;
  readonly status: InviteStatus;
  /** When they last said which times they could do; null until they have. */
  readonly answeredAt: string | null;
  readonly bookingId: Id | null;
  readonly createdBy: Id;
};

/** At most two weeks of days to choose from. */
export const MAX_INVITE_DAYS = 14;

export type InviteInput = { readonly title: string; readonly minutes: string; readonly firstDay: string; readonly lastDay: string; readonly note?: string | null };
export type InviteError = "title-missing" | "title-too-long" | "call-length" | "day-invalid" | "days-in-past" | "days-backwards" | "days-too-many" | "note-too-long";

export function newInvite(ids: { readonly id: Id; readonly organizationId: Id; readonly clientUserId: Id; readonly createdBy: Id }, input: InviteInput, today: string): Result<ScheduleInvite, InviteError> {
  const title = input.title.trim();
  if (!title) return err("title-missing");
  if (title.length > 80) return err("title-too-long");
  const minutes = Number(input.minutes);
  if (!(CALL_LENGTHS as readonly number[]).includes(minutes)) return err("call-length");
  let first: Temporal.PlainDate;
  let last: Temporal.PlainDate;
  try {
    first = Temporal.PlainDate.from(input.firstDay.trim(), { overflow: "reject" });
    last = Temporal.PlainDate.from(input.lastDay.trim(), { overflow: "reject" });
  } catch {
    return err("day-invalid");
  }
  if (Temporal.PlainDate.compare(first, Temporal.PlainDate.from(today)) < 0) return err("days-in-past");
  if (Temporal.PlainDate.compare(last, first) < 0) return err("days-backwards");
  if (first.until(last).days + 1 > MAX_INVITE_DAYS) return err("days-too-many");
  const note = (input.note ?? "").trim();
  if (note.length > 500) return err("note-too-long");
  return ok({ ...ids, title, minutes, firstDay: first.toString(), lastDay: last.toString(), note, status: "open", answeredAt: null, bookingId: null });
}

/** The days an invite covers. */
export function inviteDays(invite: Pick<ScheduleInvite, "firstDay" | "lastDay">): Temporal.PlainDate[] {
  const days: Temporal.PlainDate[] = [];
  for (let day = Temporal.PlainDate.from(invite.firstDay); Temporal.PlainDate.compare(day, Temporal.PlainDate.from(invite.lastDay)) <= 0; day = day.add({ days: 1 })) days.push(day);
  return days;
}

const HALF_HOUR_MS = 30 * 60_000;

/**
 * The times a call could start: every half hour where enough half hours in a
 * row are free for both. Each argument is a set of half-hour starts (UTC
 * instants as text); a 45-minute call needs two in a row.
 */
export function startsFreeForBoth(host: ReadonlySet<string>, guest: ReadonlySet<string>, minutes: number): string[] {
  const needed = Math.ceil(minutes / 30);
  const both = new Set([...host].filter((one) => guest.has(one)).map((one) => Temporal.Instant.from(one).epochMilliseconds));
  return [...both]
    .filter((start) => Array.from({ length: needed }, (_, n) => start + n * HALF_HOUR_MS).every((cell) => both.has(cell)))
    .sort((a, b) => a - b)
    .map((ms) => Temporal.Instant.fromEpochMilliseconds(ms).toString());
}
