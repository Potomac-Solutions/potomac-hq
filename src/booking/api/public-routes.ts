// The public booking page's forms: book a call, and with the private link,
// move or cancel it, or download its calendar file. Anyone can post here, so
// each booking is limited by address and by email, and a field only bots
// fill in turns a post away quietly.
import { Hono } from "hono";
import { bookCall, bookingByLink, calendarFor, cancelCall, moveCall, type BookingDeps } from "../application/booking.ts";
import { readForm, withMessage } from "../../shared/index.ts";
import { BOOKING_MESSAGES } from "./staff-routes.ts";
import { tell, type BookingEmails } from "./notify.ts";

export type BookingPublicDeps = {
  readonly booking: BookingDeps;
  readonly emails?: BookingEmails;
  readonly sign: (location: string) => string;
  /** Where a request came from, behind HQ's proxies. */
  readonly addressOf: (incoming: unknown) => string;
  /** At most a few bookings an hour from one address. */
  readonly allowPerAddress: (key: string) => boolean;
  /** At most a few a day for one email. */
  readonly allowPerEmail: (key: string) => boolean;
};

const MESSAGES: Readonly<Record<string, string>> = {
  ...BOOKING_MESSAGES,
  "not-found": "This link doesn’t match a booking.",
  "name-missing": "Enter your name.",
  "name-too-long": "Keep your name under 100 characters.",
  "email-invalid": "Enter your email, like you@example.com.",
  "phone-invalid": "Check the phone number: like 304-555-0142.",
  "topic-too-long": "Keep it under 1,000 characters.",
  closed: "Booking online isn’t open right now. Call or write instead.",
  "too-many": "That’s a lot of bookings at once. Call or write instead, and we’ll find a time.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

export function bookingPublicRoutes(deps: BookingPublicDeps): Hono<{ Bindings: { incoming: unknown } }> {
  const app = new Hono<{ Bindings: { incoming: unknown } }>();
  const go = (to: string, name: "done" | "problem", message: string) => new Response(null, { status: 303, headers: { location: deps.sign(withMessage(to, name, message)) } });
  const manage = (token: string) => `/book/manage?token=${encodeURIComponent(token)}`;

  app.post("/book", async (c) => {
    const { fields } = await readForm(c);
    // A bot filled in the field people never see: no booking, and nothing said about why.
    if ((fields["website"] ?? "") !== "") return c.redirect("/book", 303);
    const address = deps.addressOf(c.env.incoming);
    const email = (fields["email"] ?? "").trim().toLowerCase();
    if (!deps.allowPerAddress(address) || (email && !deps.allowPerEmail(email))) return go("/book", "problem", messageFor("too-many"));
    const made = await bookCall(deps.booking, { kind: "public", name: fields["name"] ?? "", email, phone: fields["phone"] ?? null, topic: fields["topic"] ?? null }, fields["start"] ?? "");
    if (!made.ok) return go("/book", "problem", messageFor(made.error));
    await tell(deps.booking, deps.emails ?? null, made.value.booking, { event: "made", by: "booker", manageToken: made.value.manageToken });
    return go(manage(made.value.manageToken ?? ""), "done", "You’re booked. We’ll talk then.");
  });

  app.post("/book/manage/move", async (c) => {
    const { fields } = await readForm(c);
    const token = fields["token"] ?? "";
    const moved = await moveCall(deps.booking, { kind: "link", token }, null, fields["start"] ?? "");
    if (!moved.ok) return go(moved.error === "not-found" ? "/book" : `${manage(token)}&move=1`, "problem", messageFor(moved.error));
    await tell(deps.booking, deps.emails ?? null, moved.value.booking, { event: "moved", by: "booker", was: moved.value.was, manageToken: token });
    return go(manage(token), "done", "Your call is moved. Add it to your calendar again to update it there.");
  });

  app.post("/book/manage/cancel", async (c) => {
    const { fields } = await readForm(c);
    const token = fields["token"] ?? "";
    const done = cancelCall(deps.booking, { kind: "link", token }, null, fields["reason"] ?? "");
    if (!done.ok) return go(done.error === "not-found" ? "/book" : manage(token), "problem", messageFor(done.error));
    await tell(deps.booking, deps.emails ?? null, done.value, { event: "cancelled", by: "booker" });
    return go(manage(token), "done", "Your call is cancelled.");
  });

  app.get("/book/manage/call.ics", (c) => {
    const booking = bookingByLink(deps.booking, c.req.query("token") ?? "");
    if (!booking) return c.text("Not found", 404);
    return new Response(calendarFor(deps.booking, booking), { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="call-${booking.start.slice(0, 10)}.ics"`, "cache-control": "private, no-store" } });
  });
  return app;
}
