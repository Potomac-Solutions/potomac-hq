// Logging a call, email, text or meeting, from a client's page or an
// opportunity's.
import { Hono } from "hono";
import { logTouch, type TouchDeps } from "../application/touches.ts";
import { formPosts, type Id } from "../../shared/index.ts";
import { messageFor } from "./messages.ts";

export function touchRoutes(deps: { readonly touches: TouchDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/clients" });
  const input = (f: Readonly<Record<string, string>>) => ({ kind: f["kind"] ?? "", outcome: f["outcome"] ?? null, note: f["note"] ?? null, contactId: f["contactId"] ?? null, followUpOn: f["followUpOn"] ?? null });
  post("/clients/:id/touches", (actor, f, id) => logTouch(deps.touches, actor, { clientId: id as Id }, input(f)), { done: (_, id) => `/clients/${id}#touches`, back: (id) => `/clients/${id}#touches`, message: "Logged." });
  post("/opportunities/:id/touches", (actor, f, id) => logTouch(deps.touches, actor, { opportunityId: id as Id }, input(f)), {
    done: (_, id, f) => `/opportunities/${id}#touches`,
    back: (id) => `/opportunities/${id}#touches`,
    message: "Logged.",
  });
  return app;
}
