// The words of the emails about a booked call: to the person who booked it,
// and to the host. Plain text. Every one says when, in Eastern time, and
// where to change it.
import type { Booking } from "./booking.ts";

export type BookingEmailEvent = "made" | "moved" | "cancelled" | "reminder";

export type BookerEmailInput = {
  readonly booking: Booking;
  readonly event: BookingEmailEvent;
  /** "Tue, Nov 24, 9:00 AM to 9:30 AM". */
  readonly when: string;
  /** Where to see, move or cancel it: the private link, or the portal. Null when there is none to give. */
  readonly manageUrl: string | null;
  /** Potomac's phone, if set. */
  readonly phone: string;
};

export type Email = { readonly to: string; readonly subject: string; readonly body: string };

const firstName = (name: string) => name.split(" ")[0] ?? name;

export function bookerEmail(input: BookerEmailInput): Email {
  const { booking, event, when } = input;
  const subject = {
    made: `Your call with Potomac Solutions: ${when}`,
    moved: `Your call is moved: ${when}`,
    cancelled: `Your call is cancelled: ${when}`,
    reminder: `Tomorrow: your call with Potomac Solutions, ${when}`,
  }[event];
  const opening = {
    made: `You're booked for a call with Potomac Solutions:`,
    moved: `Your call with Potomac Solutions is now:`,
    cancelled:
      booking.cancelledBy === "staff"
        ? `We're sorry: Potomac Solutions had to cancel your call on ${when}.${booking.cancelReason ? `\n\n"${booking.cancelReason}"` : ""}`
        : `Your call on ${when} is cancelled, as you asked.`,
    reminder: `A reminder of your call with Potomac Solutions:`,
  }[event];
  const lines = [`Hi ${firstName(booking.name)},`, "", opening];
  if (event !== "cancelled") lines.push("", `${when}, Eastern time`);
  if (event !== "cancelled" && booking.topic) lines.push("", `About: ${booking.topic}`);
  if (input.manageUrl) {
    lines.push("", event === "cancelled" ? `Book another time here:\n${input.manageUrl}` : `Add it to your calendar, move it or cancel it here:\n${input.manageUrl}`);
    if (booking.kind === "public" && event !== "cancelled") lines.push("", "Keep this email: that link is the way to change your booking.");
  } else if (event === "reminder" && booking.kind === "public") {
    lines.push("", "To move or cancel it, use the link in the email you got when you booked.");
  }
  if (input.phone) lines.push("", `Need us sooner? Call ${input.phone}.`);
  lines.push("", "Potomac Solutions");
  return { to: booking.email, subject, body: lines.join("\n") };
}

export type HostEmailInput = {
  readonly booking: Booking;
  readonly event: Exclude<BookingEmailEvent, "reminder">;
  readonly when: string;
  /** The old time, for a move. */
  readonly was: string;
  readonly hostEmail: string;
  /** HQ's Calls page. */
  readonly callsUrl: string;
};

/** To the host, when the person who booked it books, moves or cancels. Not when the host does it. */
export function hostEmail(input: HostEmailInput): Email {
  const { booking, event, when } = input;
  const who = booking.kind === "client" ? `${booking.name} (client)` : `${booking.name} (from the booking page)`;
  const subject = { made: `Call booked: ${booking.name}, ${when}`, moved: `Call moved: ${booking.name}, now ${when}`, cancelled: `Call cancelled: ${booking.name}, ${when}` }[event];
  const lines = [{ made: `${who} booked a call.`, moved: `${who} moved their call from ${input.was}.`, cancelled: `${who} cancelled their call.` }[event], "", `${when}, Eastern time`, `${booking.email}${booking.phone ? ` · ${booking.phone}` : ""}`];
  if (booking.topic) lines.push("", `About: ${booking.topic}`);
  if (event === "cancelled" && booking.cancelReason) lines.push("", `Why: ${booking.cancelReason}`);
  lines.push("", `All calls: ${input.callsUrl}`);
  return { to: input.hostEmail, subject, body: lines.join("\n") };
}
