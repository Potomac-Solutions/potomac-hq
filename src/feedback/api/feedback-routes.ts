// "How did we do?" from the portal (2026-11-26).
import { Hono } from "hono";
import { giveFeedback, type FeedbackDeps } from "../application/feedback.ts";
import { formPosts, type Id } from "../../shared/index.ts";

type Session = { readonly organizationId: Id; readonly clientUserId: Id; readonly name: string };
const MESSAGES: Readonly<Record<string, string>> = {
  "not-found": "That project isn’t here.",
  "invalid-score": "Pick one of the five.",
  "note-too-long": "Keep it under 1,000 characters.",
  "already-given": "You’ve already told us about that one. Thank you.",
};

export function feedbackRoutes(deps: { readonly feedback: FeedbackDeps; readonly clientOf: (cookieHeader: string) => Session | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts<Session | null>(app, { actorOf: deps.clientOf, sign: deps.sign, messageFor: (code) => MESSAGES[code] ?? "That didn’t work.", home: "/portal" });
  post("/portal/projects/:id/feedback", (session, form, id) => (session ? giveFeedback(deps.feedback, session, id as Id, { score: form["score"] ?? "", note: form["note"] ?? null }) : { ok: false, error: "not-found" }), {
    done: (given) => (given.review ? "/portal/review" : "/portal#feedback"),
    back: () => "/portal#feedback",
    message: (given) => (given.review ? "Thank you! Would you say a few words in a review? Others reading it helps a small business like ours." : given.score <= 3 ? "Thank you for telling us. Someone will be in touch to hear more." : "Thank you!"),
  });
  return app;
}
