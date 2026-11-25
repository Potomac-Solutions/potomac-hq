// The assistant's forms (decision 0015): a message, Do it, Cancel, Undo,
// New chat, and letting small changes go through. Each goes back to Home's
// conversation. A message waits for Claude's answer, as Ask HQ does.
import { Hono } from "hono";
import { cancelAction, confirmAction, newChat, sendMessage, setAutoSmall, undoAction, type AssistantDeps } from "../application/assistant.ts";
import { formPosts, type FormFields, type Id } from "../../shared/index.ts";
import { readWhere as readWhereForm } from "../application/assistant.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "message-missing": "Say what needs to happen, in under 1,000 characters.",
  "assistant-off": "The assistant is off. An admin can turn it on in Settings → AI.",
  "already-decided": "That card was already done or cancelled.",
  "cant-undo": "That one can’t be undone from here. Open it to change it.",
  "too-late": "That was more than a day ago, so it can’t be undone from here. Open it to change it.",
  "no-key": "AI needs HQ_ANTHROPIC_API_KEY set on the server.",
  "feature-off": "The assistant is off. An admin can turn it on in Settings → AI.",
  "budget-reached": "This month’s AI budget is spent. The assistant is paused until the first of the month, or until the owner raises the cap under Site builder → Model and cap.",
  "ai-unavailable": "Claude didn’t answer. Try again in a minute; nothing was changed.",
};
// A module's own refusal comes through in words already.
const messageFor = (code: string): string => MESSAGES[code] ?? (code.length > 3 && code.includes(" ") ? code : "That didn’t work. Try again.");

const CHAT = "/#chat";

export function assistantRoutes(deps: { readonly assistant: AssistantDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: CHAT });
  const a = deps.assistant;
  // From the drawer on another page: back to that page, with the drawer open.
  const back = (f: FormFields): string => {
    const from = readWhereForm(f["from"] ?? "");
    return from && from !== "/" ? `${from}${from.includes("?") ? "&" : "?"}chat=open#assistant` : CHAT;
  };
  post("/assistant", (actor, f) => sendMessage(a, actor, f["message"] ?? "", f["model"] ?? "", f["from"] ?? ""), { done: (_v, _id, f) => back(f), back: (_id, f) => back(f), message: "" });
  post("/assistant/actions/:id/do", (actor, _f, id) => confirmAction(a, actor, id as Id), { done: (_v, _id, f) => back(f), back: (_id, f) => back(f), message: "" });
  post("/assistant/actions/:id/cancel", (actor, _f, id) => cancelAction(a, actor, id as Id), { done: (_v, _id, f) => back(f), back: (_id, f) => back(f), message: "" });
  post("/assistant/actions/:id/undo", (actor, _f, id) => undoAction(a, actor, id as Id), { done: (_v, _id, f) => back(f), back: (_id, f) => back(f), message: "Undone." });
  post("/assistant/new", (actor) => newChat(a, actor), { done: (_v, _id, f) => back(f), back: (_id, f) => back(f), message: "" });
  post("/assistant/settings", (actor, f) => setAutoSmall(a, actor, f["autoSmall"] === "on"), { done: () => CHAT, back: () => CHAT, message: (on) => (on ? "Small changes now go through without asking, each with Undo." : "Every change now asks first.") });
  return app;
}
