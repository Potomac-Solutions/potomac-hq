// Booking from Potomac's website. The website's server calls these with its
// site token, never a visitor's browser: GET the open times, POST a booking.
// Answers are JSON. A wrong token is a plain 401 that says nothing about why.
import { Hono } from "hono";
import { emailBookingChange, openTimes, type Booking, type BookingDeps, type BookingEmailOptions, type BookingMail } from "../../booking/index.ts";
import { bookFromWebsite, emailKey, type WebsiteBookingDeps } from "../application/website-booking.ts";
import type { Id } from "../../shared/index.ts";

/** Emails about the booked call, as the booking module sends them; null when email is off. */
type BookingEmails = { readonly mail: BookingMail; readonly options: BookingEmailOptions; readonly log: (message: string, error?: unknown) => void } | null;

/** Emails the booker and the host about a new call, without failing the request when one does not go. */
async function tellMade(deps: BookingDeps, emails: BookingEmails, booking: Booking): Promise<void> {
  if (!emails) return;
  try {
    const failed = await emailBookingChange(deps, emails.mail, emails.options, booking, { event: "made", by: "booker" });
    if (failed > 0) emails.log(`Website booking: ${failed} email(s) about a call could not be sent`);
  } catch (error) {
    emails.log("Website booking: emailing about a call failed", error);
  }
}

export type SiteBookingRoutesDeps = WebsiteBookingDeps & {
  readonly booking: BookingDeps;
  readonly emails: BookingEmails;
  /** True for the website's own token. */
  readonly isSite: (token: string | null) => boolean;
  /** Whether new accounts can be made and emailed: booking open to the public, hours set, and email on. */
  readonly open: () => boolean;
  readonly ownerFor: () => Id | null;
  readonly publicUrl: string;
  readonly mail: (to: { readonly email: string; readonly name: string }, link: string, kind: "booked" | "known", when: string) => Promise<boolean>;
  /** Per visitor address, as the website passes it on. */
  readonly allowPerVisitor: (key: string) => boolean;
  readonly allowPerEmail: (key: string) => boolean;
  readonly allowApi: (incoming: Request) => boolean;
};

const MESSAGES: Readonly<Record<string, string>> = {
  closed: "Booking online isn’t open right now. Call or text us instead.",
  "name-missing": "Enter your name.",
  "name-too-long": "Keep your name under 80 characters.",
  "email-invalid": "Enter your email, like you@example.com.",
  "phone-invalid": "Enter your phone number, with the area code: like 304-555-0142.",
  "business-too-long": "Keep the business name under 120 characters.",
  "topic-too-long": "Keep it under 1,000 characters.",
  "time-missing": "Choose a time for your call.",
  taken: "That time was just taken. Choose another.",
  "calendar-failed": "We can’t check the calendar right now. Call or text us instead.",
  "too-many": "That’s a lot of bookings at once. Call or text us instead.",
};

const noStore = { "cache-control": "no-store" };

export function siteBookingRoutes(deps: SiteBookingRoutesDeps): Hono {
  const app = new Hono();
  const tokenOf = (header: string | undefined) => /^Bearer (\S+)$/.exec(header ?? "")?.[1] ?? null;
  const refuse = (code: string, status: 400 | 409 | 429 | 503 = 400) => Response.json({ ok: false, error: code, message: MESSAGES[code] ?? "That didn’t work. Try again." }, { status, headers: noStore });

  app.get("/api/site/booking", async (c) => {
    if (!deps.allowApi(c.req.raw)) return c.json({ ok: false }, 429, noStore);
    if (!deps.isSite(tokenOf(c.req.header("authorization")))) return c.json({ ok: false }, 401, noStore);
    if (!deps.open()) return c.json({ ok: true, open: false, callMinutes: 0, timeZone: deps.booking.timeZone, days: [] }, 200, noStore);
    const times = await openTimes(deps.booking, "public");
    const days = times.calendarFailed ? [] : times.days.map((day) => ({ day: day.day, label: day.label, slots: day.slots.map((slot) => ({ start: slot.start, label: slot.label })) }));
    return c.json({ ok: true, open: times.open && !times.calendarFailed && days.length > 0, callMinutes: times.callMinutes, timeZone: deps.booking.timeZone, days }, 200, noStore);
  });

  app.post("/api/site/booking", async (c) => {
    if (!deps.allowApi(c.req.raw)) return c.json({ ok: false }, 429, noStore);
    if (!deps.isSite(tokenOf(c.req.header("authorization")))) return c.json({ ok: false }, 401, noStore);
    // A booking is a few short fields: anything big, or without a length, is refused before it is read.
    const length = Number(c.req.header("content-length") ?? "");
    if (!Number.isInteger(length) || length <= 0 || length > 8000) return refuse("bad-request");
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
      if (body === null || typeof body !== "object" || Array.isArray(body)) return refuse("bad-request");
    } catch {
      return refuse("bad-request");
    }
    const field = (key: string, most = 2000) => (typeof body[key] === "string" ? (body[key] as string).slice(0, most) : "");
    const owner = deps.ownerFor();
    if (!deps.open() || !owner) return refuse("closed", 503);
    const key = emailKey(field("email", 300));
    if (!deps.allowPerVisitor(field("visitor", 100) || "unknown") || (key && !deps.allowPerEmail(key))) return refuse("too-many", 429);
    const result = await bookFromWebsite(deps, owner, { name: field("name", 200), email: field("email", 300), phone: field("phone", 60), business: field("business", 200), topic: field("topic", 1100), start: field("start", 60) });
    if (!result.ok) return refuse(result.error, result.error === "taken" ? 409 : 400);
    if (result.value.kind === "known") {
      const link = result.value.link;
      const sent = link ? await deps.mail({ email: link.email, name: link.name }, `${deps.publicUrl}${link.path}`, "known", "") : false;
      return c.json({ ok: true, status: "known", sent }, 200, noStore);
    }
    const { booking, link } = result.value;
    const when = deps.booking.formatWhen(booking.start);
    const sent = await deps.mail({ email: link.email, name: link.name }, `${deps.publicUrl}${link.path}`, "booked", when);
    await tellMade(deps.booking, deps.emails, booking);
    return c.json({ ok: true, status: "booked", when, sent }, 200, noStore);
  });
  return app;
}
