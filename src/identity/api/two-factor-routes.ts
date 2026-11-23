// Two-factor sign-in: the second step at sign-in (a code or a passkey),
// turning it on and off in Settings, a person's passkeys, and an admin's
// reset on the People page.
import { Hono } from "hono";
import { beginTwoFactor, confirmTwoFactor, newRecoveryCodes, passSecondStep, resetTwoFactor, setTwoFactorRule, turnOffTwoFactor, twoFactorQr, twoFactorStatus, type TwoFactorDeps } from "../application/two-factor.ts";
import { passkeyRegistrationOptions, passkeyVerifyOptions, passSecondStepWithPasskey, provePasskey, registerPasskey, removePasskey, type PasskeySite } from "../application/passkeys.ts";
import type { RateLimit } from "../application/ports.ts";
import type { RefusedDraft } from "../application/refused.ts";
import { formPosts, readForm, withMessage, type Id } from "../../shared/index.ts";

export type TwoFactorRoutesDeps = {
  readonly twoFactor: TwoFactorDeps;
  /** The fully signed-in HQ user. Null while the second step is still to do. */
  readonly actorOf: (cookieHeader: string) => Id | null;
  /** The same, but also an admin who must turn it on before anything else: for turning it on. */
  readonly setupActorOf: (cookieHeader: string) => Id | null;
  /** Someone who has passed the password and not yet the second step, with their session's key. */
  readonly pendingOf: (cookieHeader: string) => { readonly userId: Id; readonly sessionHash: string } | null;
  /** The signed-in user and their session's key, for confirming in Settings. */
  readonly sessionOf: (cookieHeader: string) => string | null;
  readonly allowAttempt: RateLimit;
  /** The address a request came from, for the rate limit. */
  readonly addressOf: (incoming: unknown) => string;
  readonly sign: (location: string) => string;
  /** The page that shows the recovery codes once, as HTML. */
  readonly codesPage: (codes: readonly string[], fresh: boolean, withPasskey?: boolean) => string;
  /** The site passkeys are bound to, given the Origin the browser sent. Null when it can't be told. */
  readonly siteOf: (origin: string | undefined) => PasskeySite | null;
  /** Writes down a wrong code. */
  readonly refused: (draft: RefusedDraft) => void;
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
  required: "HQ requires two-factor sign-in for admins, so yours stays on.",
  "yours-first": "Turn on two-factor sign-in for yourself first, in Settings.",
  "too-many": "You have 10 passkeys, the most HQ keeps. Remove one first.",
  "label-too-long": "Give the passkey a shorter name: 60 characters at most.",
  "last-method": "That is your only way past the second step. Turn off two-factor sign-in instead.",
  "passkey-expired": "That took too long. Try the passkey again.",
  "passkey-known": "That passkey is already added.",
  "passkey-unknown": "That passkey isn’t one of yours in HQ.",
  "passkey-copied": "That passkey may have been copied, so HQ refused it. Remove it in Settings and add it again.",
  "passkey-signature": "That passkey didn’t check out. Try again.",
  "passkey-malformed": "That passkey didn’t check out. Try again.",
  "passkey-wrong-kind": "That passkey didn’t check out. Try again.",
  "passkey-challenge": "That passkey didn’t check out. Try again.",
  "passkey-origin": "That passkey was used on a different address from this one. Open HQ at its usual address and try again.",
  "passkey-site": "That passkey was made for a different address from this one. Open HQ at its usual address and try again.",
  "passkey-not-present": "That passkey didn’t check out. Try again.",
  "passkey-key": "HQ can’t use that kind of passkey. Try a different one.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";
const SETTINGS = "/settings#two-factor";

export function twoFactorRoutes(deps: TwoFactorRoutesDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: SETTINGS });
  const setup = formPosts(app, { actorOf: deps.setupActorOf, sign: deps.sign, messageFor, home: SETTINGS });
  const go = (c: { redirect(to: string, status: 303): Response }, to: string, name: "done" | "problem", message: string) => c.redirect(deps.sign(withMessage(to, name, message)), 303);

  // Proof from a passkey instead of a code, when the form sent one.
  const byPasskey = (c: { req: { header(name: string): string | undefined } }, assertion: string | undefined) => {
    if (!assertion) return undefined;
    const site = deps.siteOf(c.req.header("origin"));
    const sessionHash = deps.sessionOf(c.req.header("cookie") ?? "");
    return (userId: Id) => site !== null && sessionHash !== null && provePasskey(deps.twoFactor, userId, sessionHash, site, assertion).ok;
  };

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
    if (fields["passkey"]) {
      const site = deps.siteOf(c.req.header("origin"));
      const proved = site ? passSecondStepWithPasskey(deps.twoFactor, pending.userId, pending.sessionHash, site, fields["passkey"]) : null;
      if (proved?.ok) return c.redirect("/", 303);
      const error = proved ? proved.error : "passkey-origin";
      if (error !== "not-on") deps.refused({ kind: "second-step", userId: pending.userId, address: client, detail: error });
      return go(c, "/", "problem", messageFor(error));
    }
    const passed = passSecondStep(deps.twoFactor, pending.userId, pending.sessionHash, fields["code"] ?? "");
    if (!passed.ok) {
      if (passed.error !== "not-on") deps.refused({ kind: "second-step", userId: pending.userId, address: client, detail: passed.error });
      return go(c, "/", "problem", messageFor(passed.error));
    }
    if (!passed.value.usedRecovery) return c.redirect("/", 303);
    const left = passed.value.recoveryLeft;
    const message = left === 0 ? "You used your last recovery code. Make new ones in Settings." : `You signed in with a recovery code. ${left} ${left === 1 ? "is" : "are"} left.`;
    return go(c, SETTINGS, "done", message);
  });

  setup("/settings/two-factor", (actor) => beginTwoFactor(deps.twoFactor, actor), { done: () => SETTINGS, back: () => SETTINGS, message: "Add HQ to your authenticator app, then enter the code it shows." });

  // Confirming shows the recovery codes, once: on this answer, never stored or sent on.
  app.post("/settings/two-factor/confirm", async (c) => {
    const { fields } = await readForm(c);
    const cookie = c.req.header("cookie") ?? "";
    const done = confirmTwoFactor(deps.twoFactor, deps.setupActorOf(cookie), deps.sessionOf(cookie), fields["code"] ?? "");
    if (!done.ok) return go(c, SETTINGS, "problem", messageFor(done.error));
    return new Response(deps.codesPage(done.value.recoveryCodes, false), { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  });

  // New recovery codes, shown once, like the first ones.
  app.post("/settings/two-factor/recovery-codes", async (c) => {
    const { fields } = await readForm(c);
    const made = newRecoveryCodes(deps.twoFactor, deps.actorOf(c.req.header("cookie") ?? ""), fields["code"] ?? "", byPasskey(c, fields["passkey"]));
    if (!made.ok) return go(c, SETTINGS, "problem", messageFor(made.error));
    return new Response(deps.codesPage(made.value.recoveryCodes, true), { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  });

  // For `setupActorOf`, so an admin who must turn it on can still cancel a start.
  app.post("/settings/two-factor/off", async (c) => {
    const { fields } = await readForm(c);
    const done = turnOffTwoFactor(deps.twoFactor, deps.setupActorOf(c.req.header("cookie") ?? ""), fields["code"] ?? "", byPasskey(c, fields["passkey"]));
    return done.ok ? go(c, SETTINGS, "done", "Two-factor sign-in is off. You sign in with your password alone.") : go(c, SETTINGS, "problem", messageFor(done.error));
  });

  // What the browser needs to make or use a passkey: JSON, for the page's own script.
  app.post("/passkeys/options", async (c) => {
    const { fields } = await readForm(c);
    const cookie = c.req.header("cookie") ?? "";
    const site = deps.siteOf(c.req.header("origin"));
    const sessionHash = deps.sessionOf(cookie);
    const answer = (body: unknown, status: 200 | 400 | 403 = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    if (!site || !sessionHash) return answer({ problem: messageFor("forbidden") }, 403);
    if (fields["purpose"] === "register") {
      const options = passkeyRegistrationOptions(deps.twoFactor, deps.setupActorOf(cookie), sessionHash, site);
      return options.ok ? answer(options.value) : answer({ problem: messageFor(options.error) }, options.error === "forbidden" ? 403 : 400);
    }
    // Using one: at the second step of sign-in, or signed in and proving it is you.
    const userId = deps.pendingOf(cookie)?.userId ?? deps.setupActorOf(cookie);
    if (userId === null) return answer({ problem: messageFor("forbidden") }, 403);
    const options = passkeyVerifyOptions(deps.twoFactor, userId, sessionHash, site);
    return options ? answer(options) : answer({ problem: "You have no passkeys in HQ." }, 400);
  });

  // A new passkey. The first one turns two-factor sign-in on and shows the recovery codes, once.
  app.post("/settings/passkeys", async (c) => {
    const { fields } = await readForm(c);
    const cookie = c.req.header("cookie") ?? "";
    const site = deps.siteOf(c.req.header("origin"));
    const added = site ? registerPasskey(deps.twoFactor, deps.setupActorOf(cookie), deps.sessionOf(cookie), site, { label: fields["label"] ?? null, credential: fields["credential"] ?? "" }) : null;
    if (!added?.ok) return go(c, SETTINGS, "problem", messageFor(added ? added.error : "passkey-origin"));
    if (!added.value.recoveryCodes) return go(c, SETTINGS, "done", `Passkey “${added.value.passkey.label}” added.`);
    return new Response(deps.codesPage(added.value.recoveryCodes, false, true), { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  });

  post("/settings/passkeys/:id/remove", (actor, _form, id) => removePasskey(deps.twoFactor, actor, id as Id), { done: () => SETTINGS, back: () => SETTINGS, message: "Passkey removed." });


  post("/people/two-factor-rule", (actor, form) => setTwoFactorRule(deps.twoFactor, actor, form["on"] === "1"), {
    done: () => "/people#sign-in-rules",
    back: () => "/people#sign-in-rules",
    message: "Saved.",
  });

  post("/people/:id/two-factor-reset", (actor, _form, id) => resetTwoFactor(deps.twoFactor, actor, id as Id), { done: () => "/people", back: () => "/people", message: "Their two-factor sign-in is off. They sign in with their password, and can turn it on again." });
  return app;
}

/**
 * The link that opens an authenticator app on this phone, by redirect:
 * pages can only link to web addresses, and this link starts otpauth://.
 * It holds the secret, so only its owner gets it, and nothing keeps a copy.
 */
export function twoFactorAppRoute(deps: { readonly twoFactor: TwoFactorDeps; readonly actorOf: (cookieHeader: string) => Id | null }): Hono {
  const app = new Hono();
  app.get("/settings/two-factor/app", (c) => {
    const actor = deps.actorOf(c.req.header("cookie") ?? "");
    const link = actor ? twoFactorStatus(deps.twoFactor, actor).setup?.link : null;
    if (!link) return c.text("Not found", 404);
    return new Response(null, { status: 302, headers: { location: link, "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
  });
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
