// Automatic payment from the portal, and turning it off from HQ (2026-11-26).
import { Hono } from "hono";
import { autopayApproveUrl, finishAutopay, startAutopay, stopAutopay, type AutopayDeps } from "../application/autopay.ts";
import { formPosts, parseId, withMessage, type Id } from "../../shared/index.ts";

type Session = { readonly organizationId: Id; readonly clientUserId: Id };
const MESSAGES: Readonly<Record<string, string>> = {
  unavailable: "Automatic payment isn’t available.",
  "no-plan": "Automatic payment is for plan bills, and there’s no plan on your account.",
  "platform-failed": "The payment service didn’t answer. Try again in a minute.",
  "not-started": "Start again from your portal.",
  forbidden: "You don’t have permission to do that.",
  "not-signed-in": "Sign in first.",
};

export function autopayRoutes(deps: {
  readonly autopay: AutopayDeps;
  readonly clientOf: (cookieHeader: string) => Session | null;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
}): Hono {
  const app = new Hono();
  const back = (path: string, kind: "done" | "problem", message: string) => deps.sign(withMessage(path, kind, message));
  // Started here; the client is then sent on from /portal/autopay/go, a page of HQ's
  // own, because HQ's forms may only go to HQ (as with paying an invoice by card).
  app.post("/portal/autopay", async (c) => {
    const session = deps.clientOf(c.req.header("cookie") ?? "");
    if (!session) return c.redirect("/portal/sign-in", 303);
    const started = await startAutopay(deps.autopay, session);
    return c.redirect(started.ok ? started.value.next : back("/portal#autopay", "problem", MESSAGES[started.error] ?? "That didn’t work."), 303);
  });
  const portal = formPosts<Session | null>(app, { actorOf: deps.clientOf, sign: deps.sign, messageFor: (code) => MESSAGES[code] ?? "That didn’t work.", home: "/portal" });
  portal("/portal/autopay/stop", async (session) => (session ? stopAutopay(deps.autopay, { session }) : { ok: false as const, error: "not-signed-in" }), {
    done: () => "/portal#autopay",
    back: () => "/portal#autopay",
    message: () => "Automatic payment is off, and the saved method is removed. Bills come to you to pay as before.",
  });
  const staff = formPosts<Id | null>(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor: (code) => MESSAGES[code] ?? "That didn’t work.", home: "/clients" });
  staff("/clients/:id/autopay/stop", async (actorId, _form, id) => {
    const parsed = parseId(id ?? "");
    return parsed.ok ? stopAutopay(deps.autopay, { actorId, organizationId: parsed.value }) : { ok: false as const, error: "forbidden" };
  }, { done: (_v, id) => `/clients/${id}#autopay`, back: (id) => `/clients/${id}#autopay`, message: () => "Automatic payment is off for this client." });
  return app;
}

/** The pages around the platform: on to it, and back from it. */
export function autopayPages(deps: {
  readonly autopay: AutopayDeps;
  readonly clientOf: (cookieHeader: string) => Session | null;
  readonly sign: (location: string) => string;
  readonly page: (title: string, body: string) => string;
}): Hono {
  const app = new Hono();
  const back = (path: string, kind: "done" | "problem", message: string) => deps.sign(withMessage(path, kind, message));
  app.get("/portal/autopay/go", (c) => {
    const session = deps.clientOf(c.req.header("cookie") ?? "");
    const url = session ? autopayApproveUrl(deps.autopay, session) : null;
    if (!url || !/^https:\/\//.test(url)) return c.redirect(back("/portal#autopay", "problem", "That didn’t start. Press the button again."), 303);
    const safe = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const where = deps.autopay.saved?.platform === "paypal" ? "PayPal" : "the payment service";
    const body = `<main id="main" class="hq-narrow"><h1>Taking you to ${where}</h1><p>Approve automatic payment there, and you’ll come straight back here.</p><p><a class="hq-button" href="${safe}">Continue to ${where}</a></p></main>`;
    return new Response(deps.page("Set up automatic payment", body), { status: 200, headers: { "content-type": "text/html; charset=utf-8", refresh: `0;url=${url}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  });
  app.get("/portal/autopay/done", async (c) => {
    const session = deps.clientOf(c.req.header("cookie") ?? "");
    if (!session) return c.redirect("/portal/sign-in", 303);
    const done = await finishAutopay(deps.autopay, session);
    return c.redirect(done.ok ? back("/portal#autopay", "done", `Done. Plan bills will be paid automatically from ${done.value.label || done.value.platform}.`) : back("/portal#autopay", "problem", MESSAGES[done.error] ?? "That didn’t work."), 303);
  });
  app.get("/portal/autopay/cancelled", (c) => c.redirect(back("/portal#autopay", "done", "Nothing was changed."), 303));
  return app;
}
