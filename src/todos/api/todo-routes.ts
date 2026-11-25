// To-dos' forms: add one, tick one off, reopen one. Each goes back where it
// came from: the to-dos page, Today, a client or an opportunity.
import { Hono } from "hono";
import { addTodo, completeTodo, reopenTodo, type TodosDeps } from "../application/todos.ts";
import { formPosts, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist, or it was already done.",
  "title-missing": "Say what needs doing.",
  "title-too-long": "Keep it under 200 characters.",
  "invalid-date": "Enter the day it’s due, or leave it empty.",
  "assignee-not-found": "Choose someone from the list.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";
const ID = /^[0-9a-f-]{36}$/;

/** Where to land: a client's or an opportunity's page, Today, or the to-dos page. */
export function backTo(form: Readonly<Record<string, string>>): string {
  const back = form["back"] ?? "";
  const id = form["backId"] ?? "";
  if (back === "client" && ID.test(id)) return `/clients/${id}#todos`;
  if (back === "opportunity" && ID.test(id)) return `/opportunities/${id}#todos`;
  if (back === "today") return "/today";
  return back === "everyone" || form["everyone"] === "1" ? "/todos?everyone=1" : "/todos";
}

/** An address with ?undo= added, before any #. */
const withUndo = (location: string, undo: string | null): string => {
  if (!undo) return location;
  const [path = "", hash = ""] = location.split("#");
  return `${path}${path.includes("?") ? "&" : "?"}undo=${undo}${hash ? `#${hash}` : ""}`;
};

type Remember = (actorId: Id, step: { readonly kind: "todo-done" | "todo-reopen"; readonly recordId: string; readonly was: string; readonly label: string }) => string;

export function todoRoutes(deps: { readonly todos: TodosDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string; readonly undo?: Remember }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/todos" });
  post("/todos", (actor, f) => addTodo(deps.todos, actor, { title: f["title"] ?? "", dueOn: f["dueOn"] ?? null, assigneeId: f["assigneeId"] ?? null, clientId: f["clientId"] ?? null, opportunityId: f["opportunityId"] ?? null }), {
    done: (_v, _id, f) => backTo(f),
    back: (_id, f) => backTo(f),
    message: "Added.",
  });
  // Ticking off or back on offers Undo for ten minutes (quality of life, 2026-11-25).
  const tick = (done: boolean) => (actor: Id | null, _f: Readonly<Record<string, string>>, id: Id | null) => {
    const changed = done ? completeTodo(deps.todos, actor, id as Id) : reopenTodo(deps.todos, actor, id as Id);
    if (!changed.ok || !deps.undo || actor === null) return changed.ok ? { ok: true as const, value: { undo: null as string | null } } : changed;
    return { ok: true as const, value: { undo: deps.undo(actor, { kind: done ? "todo-done" : "todo-reopen", recordId: id as string, was: "", label: `${done ? "Ticked off" : "Put back"} “${changed.value.title}”` }) } };
  };
  post("/todos/:id/done", tick(true), { done: (v, _id, f) => withUndo(backTo(f), v.undo), back: (_id, f) => backTo(f), message: "Done." });
  post("/todos/:id/reopen", tick(false), { done: (v, _id, f) => withUndo(backTo(f), v.undo), back: (_id, f) => backTo(f), message: "Back on the list." });
  return app;
}
