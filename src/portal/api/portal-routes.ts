// The portal's routes. Two groups: what HQ's own users post about the portal
// (invites, access, updates, call answers), and what a client posts from
// inside it. A client's routes take who is asking from the portal's own
// cookie and from nothing else.
import { Hono } from "hono";
import * as client from "../application/client-side.ts";
import type { ClientSession } from "../application/client-side.ts";
import * as staff from "../application/staff-side.ts";
import type { InvoiceDocument } from "../../finance/index.ts";
import type { ProposalDocument } from "../../proposals/index.ts";
import { formPosts, parseId, readForm, withMessage, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That record doesn’t exist.",
  "name-missing": "Enter their name.",
  "name-too-long": "That name is too long.",
  "invalid-email": "Enter an email address, like name@example.com.",
  "already-invited": "Someone with that email already has a portal invite or account.",
  "access-off": "Their access is turned off. Turn it on before sending a link.",
  unchanged: "Nothing changed.",
  "message-empty": "Write the message first.",
  "message-too-long": "That message is too long.",
  "already-answered": "That request has already been answered.",
  "invalid-answer": "Choose confirm or decline.",
  "when-missing": "Enter the day and time you are confirming.",
  "when-too-long": "That is too long.",
  "reply-too-long": "That reply is too long.",
  "not-awaiting-decision": "That has already been decided.",
  "invalid-decision": "Choose one of the two answers.",
  "note-required": "Say what you would like changed.",
  "note-too-long": "That is too long.",
  "typed-name-missing": "Type your full name to give your answer.",
  "decided-by-too-long": "That name is too long.",
  closed: "This proposal has already been answered.",
  "not-sent": "This proposal is not ready to answer.",
  "revised-not-sent": "This proposal is being changed. A new version is on its way.",
  "opportunity-lost": "This proposal is no longer open. Get in touch with Potomac Solutions.",
  "wanted-missing": "Say when you would like the call.",
  "wanted-too-long": "That is too long.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

/** What the inviter is shown when the link was not emailed: the link, once. */
export type LinkPage = { readonly name: string; readonly email: string; readonly link: string; readonly backTo: string };

export type StaffPortalRoutesDeps = {
  readonly portal: staff.PortalDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
  /** The address people use, for links: https://hq.potomac.solutions */
  readonly publicUrl: string;
  /** Emails a client their link. Null when email is not set up. Answers whether it was sent. */
  readonly mailLink: ((to: { readonly email: string; readonly name: string }, link: string) => Promise<boolean>) | null;
  /** The page that shows a link once, as HTML. */
  readonly linkPage: (view: LinkPage) => string;
};

/** What HQ's own users post about the portal. */
export function staffPortalRoutes(deps: StaffPortalRoutesDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/clients" });
  const clientPage = (id: string | null) => (id ? `/clients/${id}#portal` : "/clients");

  /** After an invite or a new link: email it if email is set up, otherwise show it to the inviter once. */
  async function deliver(c: { redirect(to: string, status: 303): Response }, made: staff.PortalLink): Promise<Response> {
    const link = `${deps.publicUrl}${made.path}`;
    const back = clientPage(made.user.organizationId);
    if (deps.mailLink && (await deps.mailLink({ email: made.user.email, name: made.user.name }, link))) {
      return c.redirect(deps.sign(withMessage(back, "done", `A link was emailed to ${made.user.email}. It works once, for a week.`)), 303);
    }
    // The link is a way in, so this page is never stored and never sent on as a referrer.
    return new Response(deps.linkPage({ name: made.user.name, email: made.user.email, link, backTo: back }), { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }

  app.post("/clients/:id/portal-users", async (c) => {
    const { fields } = await readForm(c);
    const id = parseId(c.req.param("id"));
    if (!id.ok) return c.redirect(deps.sign(withMessage("/clients", "problem", messageFor("not-found"))), 303);
    const made = await staff.inviteClientUser(deps.portal, deps.actorOf(c.req.header("cookie") ?? ""), id.value, { name: fields["name"] ?? "", email: fields["email"] ?? "" });
    if (!made.ok) return c.redirect(deps.sign(withMessage(made.error === "not-found" ? "/clients" : clientPage(id.value), "problem", messageFor(made.error))), 303);
    return deliver(c, made.value);
  });

  app.post("/portal-users/:id/link", async (c) => {
    const { fields } = await readForm(c);
    const id = parseId(c.req.param("id"));
    const back = clientPage(parseId(fields["organizationId"] ?? "").ok ? (fields["organizationId"] as string) : null);
    const made = id.ok ? await staff.issuePortalLink(deps.portal, deps.actorOf(c.req.header("cookie") ?? ""), id.value) : null;
    if (!made || !made.ok) return c.redirect(deps.sign(withMessage(back, "problem", messageFor(made ? made.error : "not-found"))), 303);
    return deliver(c, made.value);
  });

  app.post("/portal-users/:id/access", async (c) => {
    const { fields } = await readForm(c);
    const id = parseId(c.req.param("id"));
    const back = clientPage(parseId(fields["organizationId"] ?? "").ok ? (fields["organizationId"] as string) : null);
    const changed = id.ok ? await staff.setClientAccess(deps.portal, deps.actorOf(c.req.header("cookie") ?? ""), id.value, fields["on"] === "1") : null;
    if (!changed || !changed.ok) return c.redirect(deps.sign(withMessage(back, "problem", messageFor(changed ? changed.error : "not-found"))), 303);
    return c.redirect(deps.sign(withMessage(clientPage(changed.value.organizationId), "done", changed.value.status === "disabled" ? "Access turned off. They are signed out." : "Access turned on.")), 303);
  });

  post("/projects/:id/updates", (actor, f, id) => staff.postProjectUpdate(deps.portal, actor, id as Id, f["body"] ?? ""), {
    done: (_, id) => `/projects/${id}#updates`,
    back: (id) => `/projects/${id}#updates`,
    message: "Update posted. The client can read it in the portal.",
  });
  post("/call-requests/:id/answer", (actor, f, id) => staff.answerCallRequest(deps.portal, actor, id as Id, { answer: f["answer"] ?? "", confirmedFor: f["confirmedFor"] ?? null, reply: f["reply"] ?? null }), {
    done: (request) => clientPage(request.organizationId),
    back: (_, f) => clientPage(parseId(f["organizationId"] ?? "").ok ? (f["organizationId"] as string) : null),
    message: "Answer sent to the client’s portal.",
  });
  return app;
}

export type ClientPortalRoutesDeps = {
  readonly portal: staff.PortalDeps;
  /** The client a Cookie header is signed in as, or null. */
  readonly clientOf: (cookieHeader: string) => ClientSession | null;
  readonly sign: (location: string) => string;
  /** The address the request came from, for the sign-in limit. */
  readonly addressOf: (incoming: unknown) => string;
  /** True if this key may make another attempt now. */
  readonly allowAttempt: (key: string) => boolean;
};

/** What a client posts from inside the portal, and the portal's sign-in. */
export function clientPortalRoutes(deps: ClientPortalRoutesDeps): Hono<{ Bindings: { incoming: unknown } }> {
  const app = new Hono<{ Bindings: { incoming: unknown } }>();
  const to = (c: { redirect(to: string, status: 303): Response }, location: string, key: "done" | "problem", message: string) => c.redirect(deps.sign(withMessage(location, key, message)), 303);
  const limited = (c: { env: { incoming: unknown } }, what: string) => !deps.allowAttempt(`portal ${what} ${deps.addressOf(c.env.incoming)}`);

  app.post("/portal/sign-in", async (c) => {
    if (limited(c, "sign-in")) return to(c, "/portal/sign-in", "problem", "Too many tries. Wait a minute, then try again.");
    const { fields } = await readForm(c);
    const result = await client.signInClient(deps.portal, { email: fields["email"] ?? "", password: fields["password"] ?? "", client: deps.addressOf(c.env.incoming) });
    if (!result.ok) return to(c, "/portal/sign-in", "problem", result.error === "locked" ? "Too many wrong tries. Wait fifteen minutes, then try again." : "That email and password don’t match.");
    c.header("set-cookie", result.value.cookie);
    return c.redirect("/portal", 303);
  });

  app.post("/portal/sign-out", async (c) => {
    c.header("set-cookie", await client.signOutClient(deps.portal, c.req.header("cookie") ?? ""));
    return to(c, "/portal/sign-in", "done", "You are signed out.");
  });

  app.post("/portal/accept", async (c) => {
    if (limited(c, "accept")) return to(c, "/portal/sign-in", "problem", "Too many tries. Wait a minute, then try again.");
    const { fields } = await readForm(c);
    const token = fields["token"] ?? "";
    const result = await client.acceptPortalLink(deps.portal, token, { name: fields["name"] ?? "", password: fields["password"] ?? "" });
    // Back to the same link's page: it is still unused, so the person can try another password.
    if (!result.ok) return to(c, /^[A-Za-z0-9_-]{43}$/.test(token) ? `/portal/accept?token=${token}` : "/portal/sign-in", "problem", result.message);
    c.header("set-cookie", result.cookie);
    return to(c, "/portal", "done", "Your password is set and you are signed in.");
  });

  const post = formPosts<ClientSession | null>(app as unknown as Hono, { actorOf: deps.clientOf, sign: deps.sign, messageFor, home: "/portal" });
  /** Runs `act` for a signed-in client. Signed out, the answer is the same as for a record that is not theirs. */
  const signedIn = <V>(session: ClientSession | null, act: (session: ClientSession) => { ok: true; value: V } | { ok: false; error: string }) => (session ? act(session) : { ok: false as const, error: "not-found" });

  post("/portal/projects/:id/messages", (session, f, id) => signedIn(session, (s) => client.sendMessage(deps.portal, s, id as Id, f["body"] ?? "")), {
    done: (_, id) => `/portal/projects/${id}#updates`,
    back: (id) => `/portal/projects/${id}#updates`,
    message: "Message sent to Potomac Solutions.",
  });
  post("/portal/deliverables/:id/decision", (session, f, id) => signedIn(session, (s) => client.decideOnDeliverable(deps.portal, s, id as Id, { decision: f["decision"] ?? "", note: f["note"] ?? null })), {
    done: (deliverable) => `/portal/projects/${deliverable.projectId}#deliverables`,
    // The project comes from the form only to choose where to go back to. The service checked whose it is.
    back: (_, f) => (parseId(f["projectId"] ?? "").ok ? `/portal/projects/${f["projectId"]}#deliverables` : "/portal"),
    message: "Thank you. Your decision is recorded.",
  });
  post("/portal/proposals/:id/answer", (session, f, id) => signedIn(session, (s) => client.answerProposal(deps.portal, s, id as Id, { decision: f["decision"] ?? "", typedName: f["typedName"] ?? "" })), {
    done: (_, id) => `/portal/proposals/${id}`,
    back: (id) => `/portal/proposals/${id}`,
    message: "Thank you. Your answer is recorded.",
  });
  post("/portal/calls", (session, f) => signedIn(session, (s) => client.requestCall(deps.portal, s, { wanted: f["wanted"] ?? "", note: f["note"] ?? null })), {
    done: () => "/portal#calls",
    back: () => "/portal#calls",
    message: "Request sent. Potomac Solutions will confirm a time.",
  });
  return app;
}

export type PortalDownloadDeps = Pick<ClientPortalRoutesDeps, "portal" | "clientOf"> & {
  readonly renderProposalPdf: (document: ProposalDocument) => Uint8Array<ArrayBuffer>;
  readonly renderInvoicePdf: (document: InvoiceDocument) => Uint8Array<ArrayBuffer>;
};

/** A client's own proposal and invoice PDFs. Anything else answers 404. */
export function portalDownloads(deps: PortalDownloadDeps): Hono {
  const app = new Hono();
  const pdf = (body: Uint8Array<ArrayBuffer>, fileName: string) =>
    new Response(body, { status: 200, headers: { "content-type": "application/pdf", "content-length": String(body.length), "content-disposition": `attachment; filename="${fileName}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  app.get("/portal/proposals/:id/pdf", (c) => {
    const id = parseId(c.req.param("id"));
    const found = id.ok ? client.portalProposalDocument(deps.portal, deps.clientOf(c.req.header("cookie") ?? ""), id.value) : null;
    return found && found.ok ? pdf(deps.renderProposalPdf(found.value), found.value.fileName) : c.text("Not found", 404);
  });
  app.get("/portal/invoices/:id/pdf", (c) => {
    const id = parseId(c.req.param("id"));
    const found = id.ok ? client.portalInvoiceDocument(deps.portal, deps.clientOf(c.req.header("cookie") ?? ""), id.value) : null;
    return found && found.ok ? pdf(deps.renderInvoicePdf(found.value), found.value.fileName) : c.text("Not found", 404);
  });
  return app;
}
