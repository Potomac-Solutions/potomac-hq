// A booked call: who booked it, when, and what about.
import { err, ok, type Result } from "../../shared/domain/result.ts";
import type { Id } from "../../shared/domain/id.ts";

/** "client": a client signed in to the portal. "public": someone from the booking page, often a prospect. */
export type BookingKind = "client" | "public";
export type BookingStatus = "booked" | "cancelled";

export type Booking = {
  readonly id: Id;
  readonly kind: BookingKind;
  readonly status: BookingStatus;
  readonly start: string;
  readonly end: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly topic: string;
  /** Set for a client's booking. */
  readonly organizationId: Id | null;
  readonly clientUserId: Id | null;
  /** The HQ user whose calendar it is on. */
  readonly hostId: Id;
  readonly createdAt: string;
  readonly cancelledAt: string | null;
  readonly cancelledBy: "staff" | "booker" | null;
  readonly cancelReason: string;
};

export type BookerInput = { readonly name: string; readonly email: string; readonly phone?: string | null; readonly topic?: string | null };
export type BookerError = "name-missing" | "name-too-long" | "email-invalid" | "phone-invalid" | "topic-too-long";

/** Checks who is booking. A phone number is optional; the topic is a sentence or two. */
export function checkBooker(input: BookerInput): Result<{ name: string; email: string; phone: string; topic: string }, BookerError> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) return err("name-missing");
  if (name.length > 100) return err("name-too-long");
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("email-invalid");
  const phone = (input.phone ?? "").trim();
  if (phone && (phone.length > 30 || !/^[+()\d][\d\s().+-]{5,}$/.test(phone) || (phone.match(/\d/g) ?? []).length < 7)) return err("phone-invalid");
  const topic = (input.topic ?? "").trim();
  if (topic.length > 1000) return err("topic-too-long");
  return ok({ name, email, phone, topic });
}

export type CancelError = "already-cancelled" | "in-the-past" | "reason-too-long";

/** Cancels a call that has not started. */
export function cancel(booking: Booking, by: "staff" | "booker", reason: string, now: string): Result<Booking, CancelError> {
  if (booking.status === "cancelled") return err("already-cancelled");
  if (Temporal.Instant.compare(booking.start, now) <= 0) return err("in-the-past");
  const why = reason.trim();
  if (why.length > 500) return err("reason-too-long");
  return ok({ ...booking, status: "cancelled", cancelledAt: now, cancelledBy: by, cancelReason: why });
}

/** Whether a booked call can still be cancelled or moved. */
export const changeable = (booking: Booking, now: string): boolean => booking.status === "booked" && Temporal.Instant.compare(booking.start, now) > 0;

/** "Fri, Nov 27, 9:00 AM to 9:30 AM", read in the business's time zone. */
export function whenText(start: string, end: string, timeZone: string): string {
  const from = Temporal.Instant.from(start).toZonedDateTimeISO(timeZone);
  const to = Temporal.Instant.from(end).toZonedDateTimeISO(timeZone);
  const day = from.toPlainDate().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = (at: Temporal.ZonedDateTime) => at.toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time(from)} to ${time(to)}`;
}

/**
 * A calendar file (RFC 5545) for the call, which phones and calendar apps
 * open. The same id each time, so opening it again updates the event, and a
 * cancelled call is sent as cancelled.
 */
export function calendarFile(booking: Booking, input: { readonly title: string; readonly description: string; readonly organizer: string; readonly stamp: string }): string {
  const utc = (instant: string) => Temporal.Instant.from(instant).toString({ smallestUnit: "second" }).replace(/[-:]/g, "");
  const text = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Potomac Solutions//Potomac HQ//EN",
    `METHOD:${booking.status === "cancelled" ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${booking.id}@potomac-hq`,
    `DTSTAMP:${utc(input.stamp)}`,
    `DTSTART:${utc(booking.start)}`,
    `DTEND:${utc(booking.end)}`,
    `SUMMARY:${text(input.title)}`,
    `DESCRIPTION:${text(input.description)}`,
    `ORGANIZER;CN=Potomac Solutions:mailto:${input.organizer}`,
    `STATUS:${booking.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    `SEQUENCE:${booking.status === "cancelled" ? 1 : 0}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // Lines longer than 75 octets are folded, as the standard asks.
  return lines.map(fold).join("\r\n") + "\r\n";
}

function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const width = new TextEncoder().encode(char).length;
    if (size + width > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += width;
  }
  parts.push(current);
  return parts.join("\r\n ");
}
