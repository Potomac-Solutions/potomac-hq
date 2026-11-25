// The call screen's forms (decision 0009): start a call, change its planned
// length, keep its notes, and end it into the call log.
import { Hono } from "hono";
import { changeCallLength, endCall, keepCallNote, saveAnswers, saveCallGuide, startCall, switchGuide, type CallDeps, type CallFrom } from "../application/calls.ts";
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

/** The guide's form: `asked-3=on` ticks question 3, `answer-3` is what was said. */
function answersFrom(f: Fields) {
  const asked = new Set<number>();
  const answers = new Map<number, string>();
  for (const [key, value] of Object.entries(f)) {
    const match = /^(asked|answer)-(\d{1,2})$/.exec(key);
    if (!match) continue;
    const position = Number(match[2]);
    if (match[1] === "asked" && value) asked.add(position);
    else if (match[1] === "answer") answers.set(position, value);
  }
  return { asked, answers };
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
  post("/phone/:id/length", (actor, f, id) => changeCallLength(deps.calls, actor, id as Id, { minutes: Number(f["minutes"] ?? "") }), { done: (_, id) => screen(id), back: screen, message: (call) => `Planned for ${call.plannedMinutes} minutes.` });
  post("/phone/:id/answers", (actor, f, id) => saveAnswers(deps.calls, actor, id as Id, answersFrom(f)), { done: (_, id) => `${screen(id)}#guide`, back: (id) => `${screen(id)}#guide`, message: "Answers saved." });
  post("/phone/:id/guide", (actor, f, id) => switchGuide(deps.calls, actor, id as Id, f["situation"] ?? ""), { done: (_, id) => `${screen(id)}#guide`, back: (id) => `${screen(id)}#guide`, message: "Guide changed." });
  post("/call-guides", (actor, f) => saveCallGuide(deps.calls, actor, f["situation"] ?? "", { title: f["title"] ?? "", questions: f["questions"] ?? "" }), {
    done: (saved) => `/call-guides#guide-${saved.situation}`,
    back: (_, f) => `/call-guides#guide-${encodeURIComponent(f["situation"] ?? "")}`,
    message: (saved) => `Saved, with ${saved.count} question${saved.count === 1 ? "" : "s"}. Calls from now on use it.`,
  });
  post("/phone/:id/note", (actor, f, id) => keepCallNote(deps.calls, actor, id as Id, f["note"] ?? ""), { done: (_, id) => screen(id), back: screen, message: "Notes saved." });
  post("/phone/:id/end", (actor, f, id) => endCall(deps.calls, actor, id as Id, { outcome: f["outcome"] ?? null, note: f["note"] ?? null, followUpOn: f["followUpOn"] ?? null }), {
    done: (call) => (call.opportunityId ? `/opportunities/${call.opportunityId}#touches` : `/clients/${call.organizationId}#touches`),
    back: screen,
    message: "Call ended and logged.",
  });
  return app;
}
