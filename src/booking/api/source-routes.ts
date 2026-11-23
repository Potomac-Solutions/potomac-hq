// Linked calendars, and filling availability in from a calendar's address,
// a Timeful event or Calendly: Potomac's own days, and an invitee's answer.
import { Hono } from "hono";
import { addCalendarLink, fillAvailability, fillInvite, removeCalendarLink, sourceFrom, type SourceDeps } from "../application/sources.ts";
import { formPosts, type Id } from "../../shared/index.ts";
import { BOOKING_MESSAGES } from "./staff-routes.ts";
import type { PortalBooker } from "./portal-routes.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  ...BOOKING_MESSAGES,
  "not-found": "That doesn’t exist any more.",
  "not-open": "That invite was already booked or withdrawn.",
  "source-unknown": "Choose where to fill in from.",
  "too-many-imports": "That’s ten tries in an hour. Wait a while, then try again.",
  "fill-nothing": "That didn’t give any times that are open here, so nothing was changed.",
  "label-too-long": "Keep the name under 60 characters.",
  "links-too-many": "HQ reads up to five calendars. Remove one first.",
  "link-known": "That calendar is already linked.",
  "calendar-link-invalid": "Paste the calendar’s private address: a link starting with https:// or webcal://, usually ending in .ics.",
  "calendar-private": "That address isn’t on the public internet, so HQ won’t read it.",
  "calendar-unreachable": "The calendar couldn’t be reached. Check the address and try again.",
  "calendar-too-large": "That calendar is too big to read (over 2 MB).",
  "calendar-refused": "The calendar’s site refused that address. Copy it again from the calendar’s settings: it may have been reset.",
  "calendar-not-a-calendar": "That link opened a web page, not a calendar. Use the “secret address in iCal format” (Google) or the published ICS link (Outlook, Apple).",
  "timeful-link-invalid": "Paste the event’s link, like https://timeful.app/e/abc123.",
  "timeful-unreachable": "Timeful couldn’t be read just now. Try again in a minute.",
  "timeful-not-found": "Timeful has no event at that link.",
  "timeful-unreadable": "Timeful’s answer couldn’t be read. It may have changed how it works: mark the times by hand for now.",
  "timeful-days-only": "That event only asks about days, not times, so there are no times to bring over.",
  "timeful-empty": "Nobody has answered that event yet.",
  "timeful-hidden": "That event keeps everyone’s answers hidden, so HQ can’t read yours.",
  "calendly-token-invalid": "Paste a personal access token from Calendly: Integrations & apps → API and webhooks.",
  "calendly-refused": "Calendly refused that token. Make a new one and try again.",
  "calendly-unreachable": "Calendly couldn’t be read just now. Try again in a minute.",
  "calendly-no-types": "That Calendly account has no active event types to read times from.",
};
const messageFor = (code: string): string => (code.startsWith("timeful-who:") ? `Which name on that event is yours? It has answers from ${code.slice("timeful-who:".length)}.` : (MESSAGES[code] ?? "That didn’t work. Try again."));

export type SourceRoutesDeps = {
  readonly sources: SourceDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly bookerOf: (cookieHeader: string) => PortalBooker | null;
  readonly sign: (location: string) => string;
};

export function sourceRoutes(deps: SourceRoutesDeps): Hono {
  const app = new Hono();
  const staff = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/calls/hours" });
  const guest = formPosts(app, { actorOf: deps.bookerOf, sign: deps.sign, messageFor, home: "/portal" });
  const LINKS = "/calls/hours#calendars";

  staff("/calls/calendar-links", (actor, f) => addCalendarLink(deps.sources, actor, { label: f["label"] ?? null, link: f["link"] ?? "" }), {
    done: () => LINKS,
    back: () => LINKS,
    message: "Linked. Its busy times are no longer offered for calls.",
  });
  staff("/calls/calendar-links/:id/remove", (actor, _f, id) => removeCalendarLink(deps.sources, actor, id as Id), { done: () => LINKS, back: () => LINKS, message: "Removed. HQ has forgotten its address." });
  staff("/calls/availability/fill", (actor, f) => fillAvailability(deps.sources, actor, sourceFrom(f)), {
    done: () => "/calls/availability",
    back: () => "/calls/availability#fill",
    message: "Filled in the next two weeks. Check each week and change anything that’s off.",
  });
  guest("/portal/invites/:id/fill", async (booker, f, id) => (booker ? fillInvite(deps.sources, booker, id as Id, sourceFrom(f)) : { ok: false as const, error: "not-found" }), {
    done: (value) => `/portal/invites/${value.invite.id}`,
    back: (id) => (id ? `/portal/invites/${id}#fill` : "/portal"),
    message: "Filled in. These are saved: check them below and change any that are off.",
  });
  return app;
}
