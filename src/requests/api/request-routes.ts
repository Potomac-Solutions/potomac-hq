// Client requests (2026-11-26): the client sends one from the portal; staff
// can say one isn't going ahead.
import { Hono } from "hono";
import { declineRequest, sendRequest, type RequestsDeps } from "../application/requests.ts";
import { formPosts, type Id } from "../../shared/index.ts";

type Session = { readonly organizationId: Id; readonly clientUserId: Id; readonly name: string };

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That isn’t here.",
  "title-missing": "Say in a few words what you’d like.",
  "title-too-long": "Keep the first line under 120 characters; the rest can go in the details.",
  "details-too-long": "Keep the details under 2,000 characters.",
  "too-many-today": "That’s a lot of requests for one day. Send the rest tomorrow, or put them together in one.",
  "project-closed": "That project is finished. Choose “Not about one project” instead.",
  "decline-note-missing": "Say why, in a line: the client reads it.",
  "decline-note-too-long": "Keep the reason under 300 characters.",
  "already-done": "That request is already done or closed.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Nothing was changed.";

export function portalRequestRoutes(deps: { readonly requests: RequestsDeps; readonly clientOf: (cookieHeader: string) => Session | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts<Session | null>(app, { actorOf: deps.clientOf, sign: deps.sign, messageFor, home: "/portal" });
  post("/portal/requests", (session, form) => (session ? sendRequest(deps.requests, session, { title: form["title"] ?? "", details: form["details"] ?? null, projectId: form["projectId"] ?? null }) : { ok: false, error: "not-found" }), {
    done: () => "/portal/requests#sent",
    back: () => "/portal/requests#ask",
    message: "Sent. Potomac Solutions has it, and you can follow it here.",
  });
  return app;
}

export function staffRequestRoutes(deps: { readonly requests: RequestsDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/clients" });
  post("/requests/:id/decline", (actor, form, id) => declineRequest(deps.requests, actor, id as Id, form["note"] ?? ""), {
    done: (request) => `/clients/${request.organizationId}#requests`,
    back: (_, form) => (/^[0-9a-f-]{36}$/.test(form["client"] ?? "") ? `/clients/${form["client"]}#requests` : "/clients"),
    message: "Done. The client sees it isn’t going ahead, and why.",
  });
  return app;
}
