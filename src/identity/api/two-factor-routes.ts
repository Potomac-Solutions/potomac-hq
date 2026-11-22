// Two-factor sign-in: the second step at sign-in, turning it on and off in
// Settings, and an admin's reset on the People page.
import { Hono } from "hono";
import { beginTwoFactor, confirmTwoFactor, passSecondStep, resetTwoFactor, turnOffTwoFactor, twoFactorQr, type TwoFactorDeps } from "../application/two-factor.ts";
import type { RateLimit } from "../application/ports.ts";
import { formPosts, readForm, withMessage, type Id } from "../../shared/index.ts";

export type TwoFactorRoutesDeps = {
  readonly twoFactor: TwoFactorDeps;
  /** The fully signed-in HQ user. Null while the second step is still to do. */
  readonly actorOf: (cookieHeader: string) => Id | null;
  /** Someone who has passed the password and not yet the second step, with their session's key. */
  readonly pendingOf: (cookieHeader: string) => { readonly userId: Id; readonly sessionHash: string } | null;
  /** The signed-in user and their session's key, for confirming in Settings. */
  readonly sessionOf: (cookieHeader: string) => string | null;
  readonly allowAttempt: RateLimit;
  /** The address a request came from, for the rate limit. */
  readonly addressOf: (incoming: unknown) => string;
  readonly sign: (location: string) => string;
  /** The page that shows the recovery codes once, as HTML. */
  readonly codesPage: (codes: readonly string[]) => string;
};

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That person doesn’t exist.",
  "already-on": "Two-factor sign-in is already on.",
  "not-started": "Start again: choose “Turn on two-factor sign-in”.",
  "not-on": "Two-factor sign-in is not on.",
  "code-invalid": "Enter the 6-digit code from your app, or a recovery code like ABCDE-FGHJK.",
  "code-wrong": "That code didn’t match. Check the time on your phone is right, and try the newest code.",
  "code-used": "That code has been used. Wait for the next one.",
  yourself: "Turn off your own in Settings, with a code.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";
const SETTINGS = "/settings#two-factor";

export function twoFactorRoutes(deps: TwoFactorRoutesDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: SETTINGS });
  const go = (c: { redirect(to: string, status: 303): Response }, to: string, name: "done" | "problem", message: string) => c.redirect(deps.sign(withMessage(to, name, message)), 303);

  // The second step at sign-in. Limited like the password: five tries a minute
  // for each person, and for each address.
  app.post("/two-factor", async (c) => {
    const { fields } = await readForm(c);
    const pending = deps.pendingOf(c.req.header("cookie") ?? "");
    if (!pending) return go(c, "/", "problem", "Sign in again.");
    const client = deps.addressOf((c.env as { incoming: unknown }).incoming);
    if (!deps.allowAttempt(`two-factor ${pending.userId}`) || !deps.allowAttempt(`two-factor ${client}`)) {
      return new Response("Too many tries. Wait a minute, then try again.", { status: 429, headers: { "retry-after": "60", "content-type": "text/plain; charset=utf-8" } });
    }
    const passed = passSecondStep(deps.twoFactor, pending.userId, pending.sessionHash, fields["code"] ?? "");
    if (!passed.ok) return go(c, "/", "problem", messageFor(passed.error));
    if (!passed.value.usedRecovery) return c.redirect("/", 303);
    const left = passed.value.recoveryLeft;
    const message = left === 0 ? "You used your last recovery code. Turn two-factor sign-in off and on again in Settings to get new ones." : `You signed in with a recovery code. ${left} ${left === 1 ? "is" : "are"} left.`;
    return go(c, SETTINGS, "done", message);
  });

  post("/settings/two-factor", (actor) => beginTwoFactor(deps.twoFactor, actor), { done: () => SETTINGS, back: () => SETTINGS, message: "Add HQ to your authenticator app, then enter the code it shows." });

  // Confirming shows the recovery codes, once: on this answer, never stored or sent on.
  app.post("/settings/two-factor/confirm", async (c) => {
    const { fields } = await readForm(c);
    const cookie = c.req.header("cookie") ?? "";
    const done = confirmTwoFactor(deps.twoFactor, deps.actorOf(cookie), deps.sessionOf(cookie), fields["code"] ?? "");
    if (!done.ok) return go(c, SETTINGS, "problem", messageFor(done.error));
    return new Response(deps.codesPage(done.value.recoveryCodes), { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  });

  post("/settings/two-factor/off", (actor, form) => turnOffTwoFactor(deps.twoFactor, actor, form["code"] ?? ""), { done: () => SETTINGS, back: () => SETTINGS, message: "Two-factor sign-in is off. You sign in with your password alone." });

  post("/people/:id/two-factor-reset", (actor, _form, id) => resetTwoFactor(deps.twoFactor, actor, id as Id), { done: () => "/people", back: () => "/people", message: "Their two-factor sign-in is off. They sign in with their password, and can turn it on again." });
  return app;
}

/** The QR code an app scans while turning it on. It holds the secret: only its owner gets it, and nothing keeps a copy. */
export function twoFactorQrRoute(deps: { readonly twoFactor: TwoFactorDeps; readonly actorOf: (cookieHeader: string) => Id | null }): Hono {
  const app = new Hono();
  app.get("/settings/two-factor/qr.svg", (c) => {
    const svg = twoFactorQr(deps.twoFactor, deps.actorOf(c.req.header("cookie") ?? ""));
    if (!svg) return c.text("Not found", 404);
    return new Response(svg, { status: 200, headers: { "content-type": "image/svg+xml", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } });
  });
  return app;
}
