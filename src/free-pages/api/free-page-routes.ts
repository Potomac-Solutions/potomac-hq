// Free landing pages' forms and the zip of a page's code (decision 0013,
// section 3). Potomac's people use the client's Landing page; the client uses
// the portal's.
import { Hono } from "hono";
import { approveFreePage, archiveOf, markRoundDone, recordRound, requestFreePage, sendRound, setUpFreePage, type ClientSide, type FreePagesDeps } from "../application/free-pages.ts";
import type { SiteArchive } from "../application/ports.ts";
import { formPosts, parseId, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "subdomain-invalid": "An address is letters, digits and single hyphens, like moats-hardware.",
  "subdomain-reserved": "That name is kept for Potomac’s own use. Choose another.",
  "subdomain-taken": "Another client’s page already has that address.",
  "invalid-status": "Choose a status from the list.",
  "repo-invalid": "Enter the repository as owner/name, like Potomac-Solutions/moats-landing.",
  "already-has-one": "Someone at this client already has a free landing page with another client. It’s one free page a person.",
  "already-asked": "You’ve already asked for your free landing page.",
  "text-missing": "Say what you’d like changed.",
  "text-too-long": "Keep a round under 4,000 characters. Send the rest in the next one, or call us.",
  "not-ready": "There’s nothing to look at yet. We’ll let you know when your page is ready.",
  "paid-not-agreed": "Tick the box to say you know these changes are paid.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

export function freePageStaffRoutes(deps: { readonly freePages: FreePagesDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/landing-pages" });
  const pageOf = (id: Id | null) => `/clients/${id}/landing-page`;
  post("/clients/:id/landing-page", (actor, f, id) => setUpFreePage(deps.freePages, actor, id as Id, { subdomain: f["subdomain"] ?? "", status: f["status"] ?? "", repo: f["repo"] ?? "" }), {
    done: (_page, id) => pageOf(id),
    back: (id) => pageOf(id),
    message: "Saved.",
  });
  post("/clients/:id/landing-page/rounds", (actor, f, id) => recordRound(deps.freePages, actor, id as Id, f["text"] ?? ""), {
    done: (round, id) => `${pageOf(id)}#round-${round.number}`,
    back: (id) => `${pageOf(id)}#record`,
    message: (round) => (round.free ? `Round ${round.number} written down.` : "Written down as paid changes. Price them with the client."),
  });
  post("/landing-page-rounds/:id/done", (actor, _f, id) => markRoundDone(deps.freePages, actor, id as Id), {
    done: (_round, _id, f) => (parseId(f["organizationId"] ?? "").ok ? pageOf(f["organizationId"] as Id) : "/landing-pages"),
    back: (_id, f) => (parseId(f["organizationId"] ?? "").ok ? pageOf(f["organizationId"] as Id) : "/landing-pages"),
    message: "Marked done.",
  });
  return app;
}

export function freePagePortalRoutes(deps: { readonly freePages: FreePagesDeps; readonly clientOf: (cookieHeader: string) => ClientSide | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts<ClientSide | null>(app, { actorOf: deps.clientOf, sign: deps.sign, messageFor, home: "/portal" });
  post("/portal/landing-page", (session) => requestFreePage(deps.freePages, session), {
    done: () => "/portal/landing-page",
    back: () => "/portal/landing-page",
    message: "Asked. We’ll be in touch within two business days to get started.",
  });
  post("/portal/landing-page/rounds", (session, f) => sendRound(deps.freePages, session, f["text"] ?? "", f["paid"] === "1"), {
    done: () => "/portal/landing-page",
    back: () => "/portal/landing-page#changes",
    message: (round) => (round.free ? `Sent. That’s round ${round.number}. We’ll make the changes and let you know.` : "Sent. We’ll price these changes and check with you before we start."),
  });
  post("/portal/landing-page/approve", (session) => approveFreePage(deps.freePages, session), {
    done: () => "/portal/landing-page",
    back: () => "/portal/landing-page",
    message: "Approved. Thank you! We’ll put it live.",
  });
  return app;
}

/** The zip of a page's code: for Potomac's people from the client, and for the client from the portal. */
export function freePageDownloads(deps: { readonly freePages: FreePagesDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly clientOf: (cookieHeader: string) => ClientSide | null; readonly archive: SiteArchive | null }): Hono {
  const app = new Hono();
  const missing = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  async function send(found: ReturnType<typeof archiveOf>): Promise<Response> {
    if (!found.ok || !deps.archive) return missing();
    const bytes = await deps.archive(found.value.repo);
    if (!bytes) return new Response("The code couldn’t be fetched from GitHub. Try again in a minute.", { status: 502, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${found.value.fileName}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  }
  app.get("/clients/:id/landing-page.zip", (c) => {
    const id = parseId(c.req.param("id"));
    return id.ok ? send(archiveOf(deps.freePages, { actorId: deps.actorOf(c.req.header("cookie") ?? "") }, id.value)) : missing();
  });
  app.get("/portal/landing-page.zip", (c) => send(archiveOf(deps.freePages, { session: deps.clientOf(c.req.header("cookie") ?? "") }, null)));
  return app;
}
