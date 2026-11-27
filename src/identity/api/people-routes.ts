// The forms on the People page: invite, withdraw an invite, change roles,
// switch someone off or on, make them a new link, and remove them from HQ.
import { Hono } from "hono";
import { inviteUser, issueUserLink, setUserRoles, setUserStatus, withdrawInvite, type ManageUsersDeps, type UserLink } from "../application/manage-users.ts";
import { removeMember, type RemoveMemberDeps } from "../application/remove-member.ts";
import { ROLE_KEYS } from "../application/roles.ts";
import { formPosts, parseId, readForm, withMessage, type Id } from "../../shared/index.ts";

export type PeopleRoutesDeps = {
  readonly people: ManageUsersDeps;
  readonly removal: RemoveMemberDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
  /** The address people use, for links: https://hq.potomac.solutions */
  readonly publicUrl: string;
  /** Emails someone their link. Null when email is not set up. Answers whether it was sent. */
  readonly mailLink: ((to: { readonly email: string; readonly name: string }, link: string, kind: "invite" | "reset") => Promise<boolean>) | null;
  /** The page that shows a link once, as HTML. */
  readonly linkPage: (view: { name: string; email: string; link: string }) => string;
};

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That record doesn’t exist.",
  "invalid-name": "Enter their name.",
  "invalid-email": "Enter an email address, like name@example.com.",
  "invalid-roles": "Choose at least one role.",
  "already-a-user": "Someone with that email already has an account.",
  "already-invited": "That email already has an invite. Withdraw it to send a new one.",
  "last-admin": "HQ needs an admin who can sign in. Make someone else an admin first.",
  yourself: "You can’t turn off or remove your own account.",
  "no-one-to-take-over": "Choose who takes over their work. It must be someone active in HQ.",
  "turned-off": "Their account is turned off. Turn it on first.",
  refused: "That change was refused. Try again.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";
const HOME = "/people";

export function peopleRoutes(deps: PeopleRoutesDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: HOME });
  const rolesIn = (fields: Readonly<Record<string, string>>) => ROLE_KEYS.filter((key) => fields[`role-${key}`] === "1");
  const refused = (c: { redirect(to: string, status: 303): Response }, code: string) => c.redirect(deps.sign(withMessage(HOME, "problem", messageFor(code))), 303);

  /** Email the link if email is set up, otherwise show it to the admin once. */
  async function deliver(c: { redirect(to: string, status: 303): Response }, made: UserLink, kind: "invite" | "reset"): Promise<Response> {
    const link = `${deps.publicUrl}${made.path}`;
    if (deps.mailLink && (await deps.mailLink({ email: made.email, name: made.name }, link, kind))) {
      return c.redirect(deps.sign(withMessage(HOME, "done", `A link was emailed to ${made.email}. It works once, for a week.`)), 303);
    }
    // The link is a way in, so this page is never stored and never sent on as a referrer.
    return new Response(deps.linkPage({ name: made.name, email: made.email, link }), { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }

  app.post("/people", async (c) => {
    const { fields } = await readForm(c);
    const made = await inviteUser(deps.people, deps.actorOf(c.req.header("cookie") ?? ""), { name: fields["name"] ?? "", email: fields["email"] ?? "", roles: rolesIn(fields) });
    return made.ok ? deliver(c, made.value, "invite") : refused(c, made.error);
  });

  app.post("/people/:id/link", async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id.ok) return refused(c, "not-found");
    const made = await issueUserLink(deps.people, deps.actorOf(c.req.header("cookie") ?? ""), id.value);
    return made.ok ? deliver(c, made.value, "reset") : refused(c, made.error);
  });

  post("/people/:id/roles", (actor, form, id) => setUserRoles(deps.people, actor, id as Id, rolesIn(form)), { done: () => HOME, back: () => HOME, message: "Roles saved." });
  post("/people/:id/status", (actor, form, id) => setUserStatus(deps.people, actor, id as Id, form["on"] === "1"), { done: () => HOME, back: () => HOME, message: "Saved. Someone who is turned off is signed out at once." });
  post("/people/:id/remove", async (actor, form, id) => {
    const taker = parseId(form["taker"] ?? "");
    return removeMember(deps.removal, actor, id as Id, taker.ok ? taker.value : null);
  }, {
    done: () => HOME,
    back: (id) => (id ? `/people/${id}/remove` : HOME),
    message: (made) => `${made.name} was removed from HQ. Their open work is now ${made.takerName}’s; their name stays on past work.`,
  });
  post("/invites/:id/withdraw", (actor, _form, id) => withdrawInvite(deps.people, actor, id as Id), { done: () => HOME, back: () => HOME, message: "Invite withdrawn." });
  return app;
}
