// The portal's side of booking: a client books, moves or cancels a call for
// their own organization, and downloads its calendar file. Calls are always
// looked up through the client's organization.
import { Hono } from "hono";
import { bookCall, calendarFor, cancelCall, moveCall, type BookingDeps } from "../application/booking.ts";
import { formPosts, parseId, type Id } from "../../shared/index.ts";
import { BOOKING_MESSAGES } from "./staff-routes.ts";
import { tell, type BookingEmails } from "./notify.ts";

/** The signed-in client, as booking needs them. */
export type PortalBooker = { readonly organizationId: Id; readonly clientUserId: Id; readonly name: string; readonly email: string };

export type BookingPortalDeps = {
  readonly booking: BookingDeps;
  readonly emails?: BookingEmails;
  readonly bookerOf: (cookieHeader: string) => PortalBooker | null;
  readonly sign: (location: string) => string;
};

const MESSAGES: Readonly<Record<string, string>> = {
  ...BOOKING_MESSAGES,
  forbidden: "Sign in again.",
  "not-found": "That call isn’t one of yours.",
  "phone-invalid": "Check the phone number: like 304-555-0142.",
  "topic-too-long": "Keep it under 1,000 characters.",
  "name-missing": "Your name is missing from your account. Ask Potomac Solutions to add it.",
  "email-invalid": "Your email on your account isn’t right. Ask Potomac Solutions to fix it.",
  closed: "Booking a time is off right now. Ask for a call instead.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";
const signedIn = <V>(booker: PortalBooker | null, act: (booker: PortalBooker) => Promise<{ ok: true; value: V } | { ok: false; error: string }> | { ok: true; value: V } | { ok: false; error: string }) => (booker ? act(booker) : { ok: false as const, error: "forbidden" });

export function bookingPortalRoutes(deps: BookingPortalDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.bookerOf, sign: deps.sign, messageFor, home: "/portal#calls" });
  post("/portal/book", (booker, form) =>
    signedIn(booker, async (b) => {
      const made = await bookCall(deps.booking, { kind: "client", ...b, phone: form["phone"] ?? null, topic: form["topic"] ?? null }, form["start"] ?? "");
      if (made.ok) await tell(deps.booking, deps.emails ?? null, made.value.booking, { event: "made", by: "booker" });
      return made;
    }), {
    done: () => "/portal#calls",
    back: () => "/portal/book",
    message: "Your call is booked. It’s below, with a file to add it to your calendar.",
  });
  post("/portal/calls/:id/move", (booker, form, id) =>
    signedIn(booker, async (b) => {
      const moved = await moveCall(deps.booking, { kind: "client", organizationId: b.organizationId }, id, form["start"] ?? "");
      if (moved.ok) await tell(deps.booking, deps.emails ?? null, moved.value.booking, { event: "moved", by: "booker", was: moved.value.was });
      return moved;
    }), {
    done: () => "/portal#calls",
    back: (id) => `/portal/book?move=${id}`,
    message: "Your call is moved. Add it to your calendar again to update it there.",
  });
  post("/portal/calls/:id/cancel", (booker, form, id) =>
    signedIn(booker, async (b) => {
      const done = cancelCall(deps.booking, { kind: "client", organizationId: b.organizationId }, id, form["reason"] ?? "");
      if (done.ok) await tell(deps.booking, deps.emails ?? null, done.value, { event: "cancelled", by: "booker" });
      return done;
    }), {
    done: () => "/portal#calls",
    back: () => "/portal#calls",
    message: "Your call is cancelled. Book another time whenever suits you.",
  });
  return app;
}

/** A call's calendar file for the client whose call it is. */
export function bookingPortalDownloads(deps: BookingPortalDeps): Hono {
  const app = new Hono();
  app.get("/portal/calls/:file", (c) => {
    const match = /^(.+)\.ics$/.exec(c.req.param("file"));
    const id = match ? parseId(match[1] as string) : null;
    const booker = deps.bookerOf(c.req.header("cookie") ?? "");
    const booking = id?.ok ? deps.booking.bookings.get(id.value) : null;
    if (!booker || !booking || booking.organizationId !== booker.organizationId) return c.text("Not found", 404);
    return new Response(calendarFor(deps.booking, booking), { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="call-${booking.start.slice(0, 10)}.ics"`, "cache-control": "private, no-store" } });
  });
  return app;
}
