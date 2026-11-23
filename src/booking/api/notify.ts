// Sending the emails about a change from a route: after the change is saved,
// and without failing the request when an email does not go.
import type { Booking, BookingDeps } from "../application/booking.ts";
import { emailBookingChange, type BookingChange, type BookingEmailOptions, type BookingMail } from "../application/emails.ts";

export type BookingEmails = { readonly mail: BookingMail; readonly options: BookingEmailOptions; readonly log: (message: string, error?: unknown) => void } | null;

export async function tell(deps: BookingDeps, emails: BookingEmails, booking: Booking, change: BookingChange): Promise<void> {
  if (!emails) return;
  try {
    const failed = await emailBookingChange(deps, emails.mail, emails.options, booking, change);
    if (failed > 0) emails.log(`Booking: ${failed} email(s) about a call could not be sent`);
  } catch (error) {
    emails.log("Booking: emailing about a call failed", error);
  }
}
