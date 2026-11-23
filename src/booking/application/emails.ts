// Emails about booked calls. Sent after the change is saved, and never
// undoing it: a call stays booked whether or not the email goes. The person
// who booked gets each change; the host gets the ones they did not make.
import { whenText, type Booking } from "../domain/booking.ts";
import { bookerEmail, hostEmail, type BookingEmailEvent, type Email } from "../domain/emails.ts";
import type { BookingDeps } from "./booking.ts";

export type BookingMail = (email: Email) => Promise<boolean>;
export type BookingEmailOptions = {
  /** The address people use, for links. */
  readonly publicUrl: string;
  /** Potomac's phone, for the person who booked. */
  readonly phone: string;
};

export type BookingChange = {
  readonly event: Exclude<BookingEmailEvent, "reminder">;
  /** Who made the change: the host's side, or the person who booked. */
  readonly by: "staff" | "booker";
  /** The private link's token, right after a booking from the public page. */
  readonly manageToken?: string | null;
  /** The old start, for a move. */
  readonly was?: string;
};

function manageUrlFor(options: BookingEmailOptions, booking: Booking, event: BookingEmailEvent, token: string | null): string | null {
  if (booking.kind === "client") return `${options.publicUrl}/portal#calls`;
  if (event === "cancelled") return `${options.publicUrl}/book`;
  return token ? `${options.publicUrl}/book/manage?token=${encodeURIComponent(token)}` : null;
}

/** Emails a change. Answers how many emails failed. */
export async function emailBookingChange(deps: BookingDeps, mail: BookingMail, options: BookingEmailOptions, booking: Booking, change: BookingChange): Promise<number> {
  const when = whenText(booking.start, booking.end, deps.timeZone);
  const messages: Email[] = [bookerEmail({ booking, event: change.event, when, manageUrl: manageUrlFor(options, booking, change.event, change.manageToken ?? null), phone: options.phone })];
  const host = deps.users.get(booking.hostId);
  if (change.by === "booker" && host) {
    const was = change.was ? whenText(change.was, Temporal.Instant.from(change.was).add({ minutes: Temporal.Instant.from(booking.end).since(booking.start).total("minutes") }).toString(), deps.timeZone) : "";
    messages.push(hostEmail({ booking, event: change.event, when, was, hostEmail: host.email, callsUrl: `${options.publicUrl}/calls` }));
  }
  let failed = 0;
  for (const message of messages) {
    try {
      if (!(await mail(message))) failed++;
    } catch {
      failed++;
    }
  }
  return failed;
}

/**
 * The day-before reminder: for each booked call starting in the next 24
 * hours that was booked well before then and has had none. Each is marked
 * before it is sent, so a run that stops halfway never sends one twice.
 */
export async function sendBookingReminders(deps: BookingDeps, mail: BookingMail, options: BookingEmailOptions): Promise<{ readonly sent: number; readonly failed: number }> {
  const now = Temporal.Instant.from(deps.clock());
  const due = deps.transact(() => {
    const found = deps.bookings.dueReminders(now.toString(), now.add({ hours: 24 }).toString());
    for (const one of found) deps.bookings.markReminded(one.id, now.toString());
    return found;
  });
  let sent = 0;
  let failed = 0;
  for (const booking of due) {
    const when = whenText(booking.start, booking.end, deps.timeZone);
    try {
      if (await mail(bookerEmail({ booking, event: "reminder", when, manageUrl: booking.kind === "client" ? `${options.publicUrl}/portal#calls` : null, phone: options.phone }))) sent++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}
