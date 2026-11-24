// Booking a call straight from Potomac's website. Someone new picks a time,
// and in one step gets a portal account, their call, and an emailed link to
// their dashboard to choose a password and add or change their details.
//
// One person, one free account: someone whose email or phone is already on
// file (by the keys in identity-keys.ts, so a "+tag", Gmail dots or a
// reformatted number don't count as new) is not booked again. The sign-in
// link goes to the email on file instead, never to the one typed, so only
// the real owner can use it, and they book from their portal like any client.
import { bookCall, openTimes, type Booking, type BookingDeps } from "../../booking/index.ts";
import { emailKey, phoneKey } from "../domain/identity-keys.ts";
import { err, ok, type Id, type Result } from "../../shared/index.ts";
import { signUpForPortal, type SignUpLink } from "./sign-up.ts";

export { emailKey };
import type { PortalDeps } from "./staff-side.ts";

export type WebsiteBookingInput = {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly business?: string | null;
  readonly topic?: string | null;
  readonly start: string;
};

export type WebsiteBookingError = "closed" | "name-missing" | "name-too-long" | "email-invalid" | "phone-invalid" | "business-too-long" | "topic-too-long" | "time-missing" | "taken" | "calendar-failed";

export type WebsiteBooking =
  /** Booked: the call, and the dashboard link to email them. */
  | { readonly kind: "booked"; readonly booking: Booking; readonly link: NonNullable<SignUpLink> }
  /** Already on file: nothing booked. `link` goes to the email on file, or is null when there is none to send. */
  | { readonly kind: "known"; readonly link: SignUpLink };

export type WebsiteBookingDeps = { readonly portal: PortalDeps; readonly booking: BookingDeps };

export async function bookFromWebsite(deps: WebsiteBookingDeps, ownerId: Id, input: WebsiteBookingInput): Promise<Result<WebsiteBooking, WebsiteBookingError>> {
  const email = input.email.trim().toLowerCase();
  const keys = { email: emailKey(email), phone: phoneKey(input.phone) };
  if (!input.name.trim()) return err("name-missing");
  if (!keys.email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("email-invalid");
  if (!keys.phone || input.phone.trim().length > 30) return err("phone-invalid");
  if ((input.business ?? "").trim().length > 120) return err("business-too-long");
  const topic = (input.topic ?? "").trim();
  if (topic.length > 1000) return err("topic-too-long");
  if (!input.start.trim()) return err("time-missing");

  // Someone on file: a sign-in link to the email on file, and no new account or call.
  const known = deps.portal.people?.match(keys) ?? null;
  if (known) {
    const link = known.disabled || !known.email ? ok(null) : await signUpForPortal(deps.portal, ownerId, { name: known.name, email: known.email });
    return ok({ kind: "known", link: link.ok ? link.value : null });
  }

  // Check the time before making anything, so a taken time leaves no account behind.
  const times = await openTimes(deps.booking, "public");
  if (!times.open) return err("closed");
  if (times.calendarFailed) return err("calendar-failed");
  if (!times.days.some((day) => day.slots.some((slot) => slot.start === input.start))) return err("taken");

  const made = await signUpForPortal(deps.portal, ownerId, { name: input.name, email, phone: input.phone, business: input.business ?? null });
  if (!made.ok) return made;
  const user = deps.portal.clientUsers.byEmail(email);
  if (!made.value || !user) return err("closed");
  // The dashboard, not the booking page: the call is already booked.
  const link = { ...made.value, path: made.value.path.replace("&next=book", "") };
  const booked = await bookCall(deps.booking, { kind: "client", organizationId: user.organizationId, clientUserId: user.id, name: user.name, email: user.email, phone: input.phone.trim(), topic: topic || null }, input.start);
  if (!booked.ok) return err(booked.error === "taken" || booked.error === "calendar-failed" || booked.error === "closed" ? booked.error : "taken");
  return ok({ kind: "booked", booking: booked.value.booking, link });
}
