// HQ's side of booking: the hours, days off, cancelling a call, and a call's
// calendar file.
import { Hono } from "hono";
import { addBookingToCrm, calendarFor, cancelCall, closeBookingDay, reopenBookingDay, saveBookingSetup, type BookingDeps } from "../application/booking.ts";
import type { CrmDeps } from "../../crm/index.ts";
import { formPosts, parseId, type Id } from "../../shared/index.ts";
import { tell, type BookingEmails } from "./notify.ts";

export const BOOKING_MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That call doesn’t exist.",
  "not-changeable": "That call has already started, or was cancelled.",
  "reason-too-long": "Keep the reason under 500 characters.",
  "call-length": "Choose a call length from the list.",
  gap: "The gap between calls is 0 to 60 minutes.",
  notice: "The notice is 0 to 168 hours (a week).",
  "days-ahead": "People can book 1 to 90 days ahead.",
  "hours-invalid": "Each stretch of hours ends after it starts, and is at least one call long.",
  "hours-overlap": "Two stretches on the same day overlap.",
  "hours-too-many": "Up to two stretches a day.",
  "time-invalid": "Enter times like 09:00 or 17:30.",
  "number-invalid": "Enter whole numbers.",
  "day-invalid": "Enter a day like 2026-12-24.",
  "note-too-long": "Keep the note under 100 characters.",
  taken: "That time was just taken. Choose another.",
  closed: "Booking is off right now.",
  "calendar-failed": "The calendar couldn’t be checked just now. Try again in a minute.",
  "already-added": "That call is already in the CRM.",
  "not-public": "That call is from a client already in the CRM.",
  "business-missing": "Enter the business’s name, or theirs if there isn’t one.",
  "business-too-long": "Keep the name under 120 characters.",
  "crm-refused": "The CRM didn’t take it. Check the name, email and phone, and try again.",
};
const messageFor = (code: string): string => BOOKING_MESSAGES[code] ?? "That didn’t work. Try again.";

export type BookingStaffDeps = {
  readonly booking: BookingDeps;
  readonly crm?: CrmDeps;
  readonly emails?: BookingEmails;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
};

export function bookingStaffRoutes(deps: BookingStaffDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/calls" });
  post("/calls/hours", (actor, form) => saveBookingSetup(deps.booking, actor, form), { done: () => "/calls/hours", back: () => "/calls/hours", message: "Saved. The open times have changed." });
  post("/calls/days-off", (actor, form) => closeBookingDay(deps.booking, actor, form["day"] ?? "", form["note"] ?? ""), { done: () => "/calls/hours#days-off", back: () => "/calls/hours#days-off", message: "That day is closed to calls." });
  post("/calls/days-off/open", (actor, form) => reopenBookingDay(deps.booking, actor, form["day"] ?? ""), { done: () => "/calls/hours#days-off", back: () => "/calls/hours#days-off", message: "That day is open again." });
  post("/calls/:id/cancel", async (actor, form, id) => {
    const done = cancelCall(deps.booking, { kind: "staff", actorId: actor }, id, form["reason"] ?? "");
    if (done.ok) await tell(deps.booking, deps.emails ?? null, done.value, { event: "cancelled", by: "staff" });
    return done;
  }, { done: () => "/calls", back: () => "/calls", message: "Cancelled." });
  if (deps.crm) {
    const crm = deps.crm;
    post("/calls/:id/crm", (actor, form, id) => addBookingToCrm(deps.booking, crm, actor, id, { business: form["business"] ?? "", service: form["service"] ?? null }), {
      done: (value) => `/opportunities/${value.opportunityId}`,
      back: () => "/calls",
      message: "Added to the CRM: a client, its contact, and an opportunity at “Consult booked”.",
    });
  }
  return app;
}

/** A call's calendar file, for HQ. Permission: `call.respond`, checked by listing it. */
export function bookingStaffDownloads(deps: BookingStaffDeps & { readonly canSee: (actor: Id | null) => boolean }): Hono {
  const app = new Hono();
  app.get("/calls/:file", (c) => {
    const match = /^(.+)\.ics$/.exec(c.req.param("file"));
    const id = match ? parseId(match[1] as string) : null;
    const actor = deps.actorOf(c.req.header("cookie") ?? "");
    if (!id?.ok || !deps.canSee(actor)) return c.text("Not found", 404);
    const booking = deps.booking.bookings.get(id.value);
    if (!booking) return c.text("Not found", 404);
    return new Response(calendarFor(deps.booking, booking), { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="call-${booking.start.slice(0, 10)}.ics"`, "cache-control": "private, no-store" } });
  });
  return app;
}
