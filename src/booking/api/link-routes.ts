// Booking links: Potomac makes and withdraws them on the Calls page, and
// whoever holds one books a call with it, with no account.
import { Hono } from "hono";
import { bookWithLink, createBookingLink, linkPath, withdrawBookingLink, type LinkDeps } from "../application/links.ts";
import { formPosts, readForm, withMessage, type Id } from "../../shared/index.ts";
import { BOOKING_MESSAGES } from "./staff-routes.ts";
import { tell, type BookingEmails } from "./notify.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  ...BOOKING_MESSAGES,
  "not-found": "That link doesn’t exist, or was already withdrawn.",
  "label-missing": "Say who the link is for, like Dana at Elk Diner.",
  "label-too-long": "Keep who it’s for under 80 characters.",
  "lasts-invalid": "Choose how long the link lasts from the list.",
  "link-unknown": "That booking link isn’t one of ours. Check it was copied whole.",
  "link-ended": "That booking link has stopped working. Ask Potomac Solutions for a new one.",
  "name-missing": "Enter your name.",
  "name-too-long": "Keep your name under 100 characters.",
  "email-invalid": "Enter your email, like you@example.com.",
  "phone-invalid": "Check the phone number: like 304-555-0142.",
  "phone-missing": "Enter a phone number we can call you on.",
  "topic-missing": "Say what you’d like to talk about, in a sentence or two.",
  "topic-too-long": "Keep it under 1,000 characters.",
  "business-too-long": "Keep the business name under 120 characters.",
  closed: "Booking isn’t set up yet. Call or write instead.",
  "too-many": "That’s a lot of bookings at once. Call or write instead, and we’ll find a time.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

export type LinkRoutesDeps = {
  readonly links: LinkDeps;
  readonly emails?: BookingEmails;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
  /** Ten bookings an hour from one address. */
  readonly allowAttempt: (key: string) => boolean;
  readonly addressOf: (incoming: unknown) => string;
};

export function linkRoutes(deps: LinkRoutesDeps): Hono<{ Bindings: { incoming: unknown } }> {
  const app = new Hono<{ Bindings: { incoming: unknown } }>();
  const staff = formPosts(app as unknown as Hono, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/calls" });
  const LINKS = "/calls#booking-links";

  staff("/calls/links", (actor, f) => createBookingLink(deps.links, actor, { label: f["label"] ?? "", lasts: f["lasts"] ?? "", oneTime: f["oneTime"] === "1" }), {
    done: () => LINKS,
    back: () => LINKS,
    message: "Link made. Copy it from the list and send it to them.",
  });
  staff("/calls/links/:id/withdraw", (actor, _f, id) => withdrawBookingLink(deps.links, actor, id as Id), { done: () => LINKS, back: () => LINKS, message: "Withdrawn. The link no longer works; calls booked with it stay." });

  // Booking with a link. The token rides in the form, as it did in the page's address.
  app.post("/book/with", async (c) => {
    const { fields } = await readForm(c);
    const token = fields["link"] ?? "";
    const go = (to: string, name: "done" | "problem", message: string) => new Response(null, { status: 303, headers: { location: deps.sign(withMessage(to, name, message)) } });
    const back = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? linkPath(token) : "/book";
    if (!deps.allowAttempt(`link-booking ${deps.addressOf(c.env.incoming)}`)) return go(back, "problem", messageFor("too-many"));
    const booked = await bookWithLink(deps.links, token, { name: fields["name"] ?? "", email: fields["email"] ?? "", phone: fields["phone"] ?? null, topic: fields["topic"] ?? null, business: fields["business"] ?? null }, fields["start"] ?? "");
    if (!booked.ok) return go(booked.error === "link-unknown" ? "/book" : back, "problem", messageFor(booked.error));
    await tell(deps.links, deps.emails ?? null, booked.value.booking, { event: "made", by: "booker", manageToken: booked.value.manageToken });
    return go(`/book/manage?token=${encodeURIComponent(booked.value.manageToken)}`, "done", "You’re booked. See you then.");
  });
  return app;
}
