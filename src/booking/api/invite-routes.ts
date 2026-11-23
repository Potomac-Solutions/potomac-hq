// Scheduling invites' forms. Potomac invites someone in the portal to pick
// times, confirms one, or withdraws it; the invitee answers in the portal.
// The invitee is emailed when invited, and both hear when it is booked.
import { Hono } from "hono";
import { answerInvite, cancelInvite, confirmInvite, createInvite, type InviteDeps } from "../application/invites.ts";
import { formPosts, type Id } from "../../shared/index.ts";
import { BOOKING_MESSAGES } from "./staff-routes.ts";
import { tell, type BookingEmails } from "./notify.ts";
import type { PortalBooker } from "./portal-routes.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  ...BOOKING_MESSAGES,
  "not-found": "That invite doesn’t exist.",
  "title-missing": "Say what the call is for, like Kickoff call.",
  "title-too-long": "Keep it under 80 characters.",
  "day-invalid": "Enter the first and last days.",
  "days-in-past": "Start from today or later.",
  "days-backwards": "The last day comes after the first.",
  "days-too-many": "Up to two weeks of days.",
  "note-too-long": "Keep the note under 500 characters.",
  "no-access": "Their portal access is off. Turn it on first.",
  "not-open": "That invite was already booked or withdrawn.",
  taken: "That time isn’t free for both of you any more. Choose another.",
  "no-host": "Set your hours first.",
  "who-missing": "Choose who to invite.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

export type InviteRoutesDeps = {
  readonly invites: InviteDeps;
  readonly emails?: BookingEmails;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly bookerOf: (cookieHeader: string) => PortalBooker | null;
  readonly sign: (location: string) => string;
};

export function inviteRoutes(deps: InviteRoutesDeps): Hono {
  const app = new Hono();
  const staff = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/calls" });
  const guest = formPosts(app, { actorOf: deps.bookerOf, sign: deps.sign, messageFor: (code) => (code === "not-found" ? "That record doesn’t exist." : messageFor(code)), home: "/portal" });

  staff(
    "/invites",
    async (actor, f) => {
      const who = f["clientUserId"] ?? "";
      if (!/^[0-9a-f-]{36}$/.test(who)) return { ok: false as const, error: "who-missing" };
      const made = createInvite(deps.invites, actor, who as Id, { title: f["title"] ?? "", minutes: f["minutes"] ?? "", firstDay: f["firstDay"] ?? "", lastDay: f["lastDay"] ?? "", note: f["note"] ?? null });
      if (made.ok && deps.emails) {
        const person = deps.invites.people.get(made.value.clientUserId);
        if (person) {
          const link = `${deps.emails.options.publicUrl}/portal/invites/${made.value.id}`;
          const sent = await deps.emails
            .mail({ to: person.email, subject: `Pick times for a call: ${made.value.title}`, body: `Hi ${person.name},\n\nPotomac Solutions would like to find a time for a ${made.value.minutes}-minute call: ${made.value.title}.${made.value.note ? `\n\n${made.value.note}` : ""}\n\nOpen this link, sign in to your client portal, and mark every time you could do. We'll confirm one and you'll both get it on your calendars:\n\n${link}\n\nPotomac Solutions` })
            .catch(() => false);
          if (!sent) deps.emails.log("Booking: an invite to pick times could not be emailed");
        }
      }
      return made;
    },
    { done: (invite) => `/calls/invites/${invite.id}`, back: (_id, f) => (/^[0-9a-f-]{36}$/.test(f["organizationId"] ?? "") ? `/clients/${f["organizationId"]}#portal` : "/calls"), message: "Invited. They pick times in their portal; you’ll see them here." },
  );
  staff(
    "/invites/:id/confirm",
    async (actor, f, id) => {
      const done = await confirmInvite(deps.invites, actor, id as Id, f["start"] ?? "");
      if (done.ok) await tell(deps.invites, deps.emails ?? null, done.value.booking, { event: "made", by: "staff" });
      return done;
    },
    { done: (value) => `/calls/invites/${value.invite.id}`, back: (id) => `/calls/invites/${id}`, message: "Booked. You both have it." },
  );
  staff("/invites/:id/cancel", (actor, _f, id) => cancelInvite(deps.invites, actor, id as Id), { done: (invite) => `/calls/invites/${invite.id}`, back: (id) => `/calls/invites/${id}`, message: "Withdrawn. It’s gone from their portal." });
  guest(
    "/portal/invites/:id",
    async (booker, f, id) => (booker ? answerInvite(deps.invites, booker, id as Id, f) : { ok: false as const, error: "not-found" }),
    { done: (invite) => `/portal/invites/${invite.id}`, back: (id) => (id ? `/portal/invites/${id}` : "/portal"), message: "Thank you. Potomac Solutions will confirm a time and email you." },
  );
  return app;
}
