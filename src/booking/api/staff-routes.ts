// HQ's side of booking: the hours, days off, cancelling a call, and a call's
// calendar file.
import { Hono } from "hono";
import { addBookingToCrm, bookNextCall, calendarFor, cancelCall, closeBookingDay, reopenBookingDay, saveBookingSetup, saveWeekGrid, saveWeeklyGrid, type BookingDeps } from "../application/booking.ts";
import type { CallDeps, CrmDeps } from "../../crm/index.ts";
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
  "hours-invalid": "Each stretch of hours ends after it starts.",
  "hours-overlap": "Two stretches on the same day overlap.",
  "hours-too-many": "That’s too many separate stretches in one day. Join some up.",
  "no-hours-yet": "Paint your usual week first, on the Hours page.",
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
  "call-ended": "That call has ended. Book from the Calls page instead.",
  "contact-email-missing": "The person on this call has no email in HQ, so they couldn’t be sent the booking. Add one to their contact first.",
  "email-invalid": "The email on their contact doesn’t look right. Fix it on the client’s page first.",
  "name-missing": "Their contact needs a name first.",
  "name-too-long": "Their contact’s name is too long for a booking.",
  "phone-invalid": "The phone number on the call doesn’t look right.",
  "time-missing": "Choose a time.",
};
const messageFor = (code: string): string => BOOKING_MESSAGES[code] ?? "That didn’t work. Try again.";

export type BookingStaffDeps = {
  readonly booking: BookingDeps;
  readonly crm?: CrmDeps;
  /** The call screen, for booking the next call from it (decision 0009). */
  readonly calls?: CallDeps;
  readonly emails?: BookingEmails;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
};

export function bookingStaffRoutes(deps: BookingStaffDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/calls" });
  post("/calls/hours", (actor, form) => saveBookingSetup(deps.booking, actor, form), { done: () => "/calls/hours", back: () => "/calls/hours", message: "Saved. The open times have changed." });
  post("/calls/hours/week", (actor, form) => saveWeeklyGrid(deps.booking, actor, form), { done: () => "/calls/hours#usual-week", back: () => "/calls/hours#usual-week", message: "Your usual week is saved. The open times have changed." });
  // The week comes from the form; the service checks it is a day.
  const weekPage = (form: Readonly<Record<string, string>>) => (/^\d{4}-\d{2}-\d{2}$/.test(form["week"] ?? "") ? `/calls/availability?week=${form["week"]}` : "/calls/availability");
  post("/calls/availability", (actor, form) => saveWeekGrid(deps.booking, actor, form["week"] ?? "", form), {
    done: (_value, _id, form) => weekPage(form),
    back: (_id, form) => weekPage(form),
    message: "Saved. Days painted differently from your usual week are marked “changed”.",
  });
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
  if (deps.calls) {
    const calls = deps.calls;
    const screen = (id: Id | null) => `/phone/${id}#wrap-up`;
    post("/phone/:id/book", async (actor, form, id) => {
      const booked = await bookNextCall(deps.booking, calls, actor, id as Id, form["start"] ?? "");
      if (booked.ok) await tell(deps.booking, deps.emails ?? null, booked.value.booking, { event: "made", by: "staff", manageToken: booked.value.manageToken });
      return booked;
    }, {
      done: (_, id) => screen(id),
      back: screen,
      message: (booked) => `Booked: ${Temporal.Instant.from(booked.booking.start).toZonedDateTimeISO(deps.booking.timeZone).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}. ${deps.emails ? "They’ve been emailed the details." : "Email is off, so tell them the time."}`,
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
