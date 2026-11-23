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

export function todoRoutes(deps: { readonly todos: TodosDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/todos" });
  post("/todos", (actor, f) => addTodo(deps.todos, actor, { title: f["title"] ?? "", dueOn: f["dueOn"] ?? null, assigneeId: f["assigneeId"] ?? null, clientId: f["clientId"] ?? null, opportunityId: f["opportunityId"] ?? null }), {
    done: (_v, _id, f) => backTo(f),
    back: (_id, f) => backTo(f),
    message: "Added.",
  });
  post("/todos/:id/done", (actor, _f, id) => completeTodo(deps.todos, actor, id as Id), { done: (_v, _id, f) => backTo(f), back: (_id, f) => backTo(f), message: "Done." });
  post("/todos/:id/reopen", (actor, _f, id) => reopenTodo(deps.todos, actor, id as Id), { done: (_v, _id, f) => backTo(f), back: (_id, f) => backTo(f), message: "Back on the list." });
  return app;
}
