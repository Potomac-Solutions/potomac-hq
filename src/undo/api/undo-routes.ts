// Undo (quality of life, 2026-11-25): the button the page offers after a change.
import { Hono } from "hono";
import { runUndo, type UndoDeps } from "../application/undo.ts";
import { formPosts, type FormFields, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "There’s nothing to undo.",
  "too-late": "That was more than ten minutes ago. Change it back by hand.",
};

const backTo = (f: FormFields): string => {
  const back = f["back"] ?? "";
  return back.startsWith("/") && !back.startsWith("//") && !back.includes("\\") && back.length < 300 ? back.replace(/[?&](undo|done|problem)=[^&#]*/g, "").replace(/^([^?]*)&/, "$1?") : "/";
};

export function undoRoutes(deps: { readonly undo: UndoDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor: (code) => MESSAGES[code] ?? (code.includes(" ") ? code : "That couldn’t be undone."), home: "/" });
  post("/undo/:id", (actor, _f, id) => runUndo(deps.undo, actor, id as Id), { done: (_v, _id, f) => backTo(f), back: (_id, f) => backTo(f), message: "Undone." });
  return app;
}
