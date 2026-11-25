// The call screen's forms (decision 0009): start a call, change its planned
// length, keep its notes, and end it into the call log.
import { Hono } from "hono";
import { changeCallLength, endCall, keepCallNote, startCall, type CallDeps, type CallFrom } from "../application/calls.ts";
import { err, formPosts, type Id } from "../../shared/index.ts";
import { messageFor } from "./messages.ts";

type Fields = Readonly<Record<string, string>>;

/** Where a call is started from: one of the form's hidden fields. */
function fromForm(f: Fields): CallFrom | null {
  for (const key of ["bookingId", "opportunityId", "contactId", "clientId"] as const) {
    const value = (f[key] ?? "").trim();
    if (value) return { [key]: value as Id } as unknown as CallFrom;
  }
  return null;
}

/** Back to the page the call was started from, or Today. */
const backFrom = (f: Fields) => {
  const to = (f["back"] ?? "").trim();
  return /^\/(?![\/\\])/.test(to) ? to : "/today";
};

export function callRoutes(deps: { readonly calls: CallDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/today" });
  const screen = (id: Id | null) => `/phone/${id}`;
  post("/phone", (actor, f) => {
    const from = fromForm(f);
    return from ? startCall(deps.calls, actor, from) : err("not-found");
  }, {
    done: (started) => `/phone/${started.call.id}`,
    back: (_, f) => backFrom(f),
    message: (started) => (started.already ? "You're still on this call. End it before starting another." : "The timer's running."),
  });
  post("/phone/:id/longer", (actor, _f, id) => changeCallLength(deps.calls, actor, id as Id, 1), { done: (_, id) => screen(id), back: screen, message: (call) => `Planned for ${call.plannedMinutes} minutes.` });
  post("/phone/:id/shorter", (actor, _f, id) => changeCallLength(deps.calls, actor, id as Id, -1), { done: (_, id) => screen(id), back: screen, message: (call) => `Planned for ${call.plannedMinutes} minutes.` });
  post("/phone/:id/note", (actor, f, id) => keepCallNote(deps.calls, actor, id as Id, f["note"] ?? ""), { done: (_, id) => screen(id), back: screen, message: "Notes saved." });
  post("/phone/:id/end", (actor, f, id) => endCall(deps.calls, actor, id as Id, { outcome: f["outcome"] ?? null, note: f["note"] ?? null, followUpOn: f["followUpOn"] ?? null }), {
    done: (call) => (call.opportunityId ? `/opportunities/${call.opportunityId}#touches` : `/clients/${call.organizationId}#touches`),
    back: screen,
    message: "Call ended and logged.",
  });
  return app;
}
