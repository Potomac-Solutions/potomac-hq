// Saved replies' forms (quality of life, 2026-11-25).
import { Hono } from "hono";
import { removeReply, saveReply, type RepliesDeps } from "../application/replies.ts";
import { formPosts, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That reply doesn’t exist.",
  "title-missing": "Give it a short title.",
  "title-too-long": "Keep the title under 80 characters.",
  "body-missing": "Write the reply.",
  "body-too-long": "Keep it under 5,000 characters.",
};

export function replyRoutes(deps: { readonly replies: RepliesDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor: (code) => MESSAGES[code] ?? "That didn’t work. Try again.", home: "/replies" });
  post("/replies", (actor, f) => saveReply(deps.replies, actor, null, { title: f["title"] ?? "", body: f["body"] ?? "" }), { done: () => "/replies", back: () => "/replies", message: "Saved." });
  post("/replies/:id", (actor, f, id) => saveReply(deps.replies, actor, id, { title: f["title"] ?? "", body: f["body"] ?? "" }), { done: () => "/replies", back: () => "/replies", message: "Saved." });
  post("/replies/:id/remove", (actor, _f, id) => removeReply(deps.replies, actor, id as Id), { done: () => "/replies", back: () => "/replies", message: "Removed." });
  return app;
}
