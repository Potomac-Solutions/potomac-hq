// The "Forgot your password?" form's post.
import { Hono } from "hono";
import type { RateLimit } from "../application/ports.ts";

export type ForgotRoutesDeps = {
  /** Null when email is not set up: the form then only says who to ask. */
  readonly request: ((email: string) => Promise<void>) | null;
  readonly clientOf: (raw: unknown) => string;
  readonly allowPerAddress: RateLimit;
  readonly allowPerEmail: RateLimit;
  readonly sign: (location: string) => string;
};

export const FORGOT_DONE = "If that email has an account, a link to set a new password is on its way. It works once.";

export function forgotRoutes(deps: ForgotRoutesDeps): Hono<{ Bindings: { incoming: unknown } }> {
  const app = new Hono<{ Bindings: { incoming: unknown } }>();
  app.post("/forgot-password", async (c) => {
    const back = (key: "done" | "problem", text: string) => c.redirect(deps.sign(`/forgot-password?${key}=${encodeURIComponent(text)}`), 303);
    if (!deps.request) return back("problem", "Email is not set up yet. Ask an administrator for a reset link.");
    const form = await c.req.parseBody();
    const email = typeof form["email"] === "string" ? form["email"].trim().toLowerCase() : "";
    if (!deps.allowPerAddress(`forgot ${deps.clientOf(c.env.incoming)}`)) return back("problem", "Too many tries. Wait an hour, then try again.");
    // Counted per email too, so one inbox cannot be flooded from many addresses.
    // Answered the same as a sent link, so the limit says nothing about the account.
    if (email && deps.allowPerEmail(`forgot ${email}`)) await deps.request(email);
    return back("done", FORGOT_DONE);
  });
  return app;
}
