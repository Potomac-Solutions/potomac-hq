// Paying an invoice by card (decision 0018): the portal's button, the page
// the platform sends the client back to, and the pages HQ serves for a
// platform that pays in a frame (Helcim) or for test mode.
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { TestProvider } from "@potomac-solutions/kit/pay";
import { framePage, frameSources } from "@potomac-solutions/kit/pay/providers";
import { payStep, settleCardPayment, startCardPayment, type CardPayDeps, type Outcome } from "../application/card-pay.ts";
import { parseId, readForm, withMessage, type Id } from "../../shared/index.ts";

type Session = { readonly organizationId: Id } | null;
type RouteDeps = { readonly cardPay: CardPayDeps; readonly clientOf: (cookieHeader: string) => Session; readonly sign: (location: string) => string; readonly test: TestProvider | null };

const HOME = "/portal#invoices";
const START_PROBLEMS: Readonly<Record<string, string>> = {
  "not-found": "That invoice isn’t here.",
  "not-set-up": "Paying by card isn’t set up. The other ways to pay are below.",
  "nothing-owed": "Nothing is owed on that invoice.",
  "in-progress": "That payment is already starting. Give it a moment, then try again.",
  "card-pay-failed": "The card payment page couldn’t be opened. Nothing was charged. Try again in a minute, or pay another way.",
};

function after(outcome: Outcome): string {
  if (outcome === "paid") return withMessage(HOME, "done", "Paid. Thank you.");
  if (outcome === "paid-needs-a-look") return withMessage(HOME, "problem", "We received a payment, but couldn’t put it on this invoice. Potomac Solutions will be in touch to sort it out.");
  if (outcome === "closed") return withMessage(HOME, "problem", "That invoice is no longer open, and nothing was charged. If that’s a surprise, get in touch with Potomac Solutions.");
  if (outcome === "not-paid") return withMessage(HOME, "problem", "We haven’t received that payment. If you just paid, give it a minute and look again; otherwise you can try again.");
  return HOME;
}

/** What a client posts. */
export function cardPayRoutes(deps: RouteDeps): Hono {
  const app = new Hono();
  app.post("/portal/invoices/:id/pay", async (c) => {
    const id = parseId(c.req.param("id"));
    const started = id.ok ? await startCardPayment(deps.cardPay, deps.clientOf(c.req.header("cookie") ?? ""), id.value) : ({ ok: false, error: "not-found" } as const);
    return c.redirect(deps.sign(started.ok ? started.value.next : withMessage(HOME, "problem", START_PROBLEMS[started.error] ?? START_PROBLEMS["card-pay-failed"]!)), 303);
  });
  // What the platform's frame said, posted by the page HQ served around it.
  app.post("/portal/invoices/:id/pay/told", async (c) => {
    const id = parseId(c.req.param("id"));
    const { fields } = await readForm(c);
    const mine = id.ok && payStep(deps.cardPay, deps.clientOf(c.req.header("cookie") ?? ""), id.value) !== null;
    return c.redirect(deps.sign(mine && id.ok ? after(await settleCardPayment(deps.cardPay, id.value, fields["told"] ?? "")) : HOME), 303);
  });
  // Test mode's stand-in for the platform's page: Pay or Decline, and back.
  app.post("/pay/test", async (c) => {
    const ref = c.req.query("ref") ?? "";
    const shown = deps.test?.pageFor(ref);
    if (!deps.test || !shown) return c.text("Not found", 404);
    const { fields } = await readForm(c);
    if (fields["answer"] === "pay") deps.test.approve(ref);
    return c.redirect(shown.back || HOME, 303);
  });
  return app;
}

const escape = (text: string): string => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);

/** What a client's browser gets. */
export function cardPayPages(deps: RouteDeps): Hono {
  const app = new Hono();
  // Where the platform sends the client back. It asks the platform; the address proves nothing.
  app.get("/portal/invoices/:id/paid", async (c) => {
    const id = parseId(c.req.param("id"));
    return c.redirect(deps.sign(id.ok ? after(await settleCardPayment(deps.cardPay, id.value)) : HOME), 303);
  });
  // Where the platform sends a client who backed out. Asked all the same: "cancel" pressed after paying is still paid.
  app.get("/portal/invoices/:id/not-paid", async (c) => {
    const id = parseId(c.req.param("id"));
    const outcome = id.ok ? await settleCardPayment(deps.cardPay, id.value) : "nothing";
    return c.redirect(deps.sign(outcome === "not-paid" || outcome === "nothing" ? withMessage(HOME, "problem", "You left before paying, so nothing was charged. Pay by card again whenever you’re ready, or pay another way.") : after(outcome)), 303);
  });
  // A platform that pays in a frame: the kit's page around it, with only that platform's addresses let in.
  app.get("/portal/invoices/:id/pay/frame", (c) => {
    const id = parseId(c.req.param("id"));
    const step = id.ok ? payStep(deps.cardPay, deps.clientOf(c.req.header("cookie") ?? ""), id.value) : null;
    if (!step?.frame) return c.redirect(deps.sign(HOME), 303);
    const nonce = randomBytes(16).toString("base64");
    const sources = frameSources(step.frame);
    const html = framePage(step.frame, { ref: step.ref, settle: `/portal/invoices/${step.invoiceId}/pay/told`, cancel: HOME, title: `Pay invoice ${step.label} · ${step.amount}`, nonce });
    return c.html(html, 200, {
      "cache-control": "no-store",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}' ${sources.script.join(" ")}; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; frame-src ${sources.frame.join(" ")}; connect-src ${sources.frame.join(" ")}; img-src ${sources.frame.join(" ")} data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    });
  });
  app.get("/pay/test", (c) => {
    const ref = c.req.query("ref") ?? "";
    const shown = deps.test?.pageFor(ref);
    if (!shown) return c.text("Not found", 404);
    return c.html(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Test payment page</title><link rel="stylesheet" href="/assets/theme.css"></head><body><main class="hq-page"><h1>Test payment page</h1><p>This stands in for the payment platform’s page while HQ is in test mode. <strong>$${(shown.cents / 100).toFixed(2)}</strong>. No money moves.</p><form method="post" action="/pay/test?ref=${escape(encodeURIComponent(ref))}" class="hq-form-row"><button class="hq-button" name="answer" value="pay">Pay</button> <button class="hq-button secondary" name="answer" value="decline">Decline</button></form></main></body></html>`,
      200,
      { "cache-control": "no-store" },
    );
  });
  return app;
}
