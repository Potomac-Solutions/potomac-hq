// Paying an invoice by card from the portal (decision 0018). In test mode,
// end to end through HQ's own stand-in for the platform's page; then with
// Stripe's calls faked, the webhook included. The platform is one setting:
// nothing else in HQ differs between the two halves.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import { cardPayConfigFrom } from "../../src/cardpay/adapters.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, events, signIn, testApp, textOf, wonProject, type Client, type TestApp } from "../support/harness.ts";

const locationOf = (res: Response) => res.headers.get("location") ?? "";
const said = (res: Response, t: TestApp, name: "done" | "problem") => new URL(locationOf(res), t.origin).searchParams.get(name) ?? "";
const invoiceIdIn = (res: Response) => /\/invoices\/([0-9a-f-]{36})/.exec(locationOf(res))?.[1] as Id;

async function world(config: Parameters<typeof testApp>[0]) {
  const t = await testApp(config);
  const admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const won = await wonProject(t.services, mikey, { client: "Better Days Towing", title: "Website rebuild" });
  const stacy = await clientSignedIn(t, admin, won.client.id, "Stacy Roberts", "stacy@betterdays.example");
  const other = await wonProject(t.services, mikey, { client: "Nu-Finish Collision", title: "Landing page" });
  const grover = await clientSignedIn(t, admin, other.client.id, "John Groves", "grover@nufinish.example");
  const bill = async (amount: string, description = "Domain transfer") => invoiceIdIn(await admin.post(`/clients/${won.client.id}/invoices`, { kind: "other", description, amount, send: "on" }));
  return { t, admin, stacy, grover, bill };
}

let w: Awaited<ReturnType<typeof world>>;
before(async () => {
  w = await world({ cardPay: { platform: "test", settings: {} } });
});
after(() => w.t.stop());

test("with no platform set up there is no button, only a pasted link, and the post is refused in words", async () => {
  const off = await world({});
  try {
    const id = await off.bill("20");
    assert.doesNotMatch(await off.stacy.page("/portal"), new RegExp(`action="/portal/invoices/${id}/pay"`));
    assert.equal(said(await off.stacy.post(`/portal/invoices/${id}/pay`, {}), off.t, "problem"), "Paying by card isn’t set up. The other ways to pay are below.");
    assert.match(textOf(await off.admin.page("/status")), /Card payments[\s\S]*Not set up/);
  } finally {
    await off.t.stop();
  }
});

test("a client pays an invoice by card: to the platform's page and back, recorded once, with no one in HQ touching it", async () => {
  const { t, admin, stacy } = w;
  const id = await w.bill("125.50");
  const portal = await stacy.page("/portal");
  assert.match(portal, new RegExp(`<form[^>]*action="/portal/invoices/${id}/pay"`));
  assert.match(textOf(portal), /“Pay by card” is in test mode: no money moves\./);

  // The button: to HQ's own step, which names the amount and sends the browser on.
  const pressed = await stacy.post(`/portal/invoices/${id}/pay`, {});
  assert.equal(new URL(locationOf(pressed), t.origin).pathname, `/portal/invoices/${id}/pay`);
  const step = await stacy.get(`/portal/invoices/${id}/pay`);
  assert.equal(step.status, 200);
  const refresh = step.headers.get("refresh") ?? "";
  assert.match(refresh, /^0;url=\/pay\/test\?ref=test_page_\d+$/);
  const stepText = textOf(await step.text());
  assert.match(stepText, /Pay invoice INV-\d{4}[\s\S]*\$125\.50[\s\S]*Test mode: no money moves\.[\s\S]*Continue to the test page/);
  const platformPage = refresh.slice("0;url=".length);

  // Back before paying: nothing recorded, and words that don't say "paid".
  const early = await stacy.get(`/portal/invoices/${id}/paid`);
  assert.match(said(early, t, "problem"), /We haven’t received that payment/);
  assert.equal(t.services.finance.invoices.get(id)?.status, "sent");

  // Pressed again: the same page at the platform, not a second one.
  await stacy.post(`/portal/invoices/${id}/pay`, {});
  assert.equal((await stacy.get(`/portal/invoices/${id}/pay`)).headers.get("refresh"), refresh);

  assert.match(textOf(await stacy.page(platformPage)), /Test payment page[\s\S]*\$125\.50[\s\S]*No money moves/);
  const paid = await stacy.post(platformPage, { answer: "pay" });
  assert.equal(new URL(locationOf(paid), t.origin).pathname, `/portal/invoices/${id}/paid`);
  const back = await stacy.get(`/portal/invoices/${id}/paid`);
  assert.equal(said(back, t, "done"), "Paid. Thank you.");
  assert.equal(new URL(locationOf(back), t.origin).hash, "#invoices");

  const invoice = t.services.finance.invoices.get(id);
  assert.deepEqual([invoice?.status, invoice?.paidMinor], ["paid", 12550]);
  const payments = t.db.prepare("select method, amount_minor, reference from payment where invoice_id = ?").all(id);
  assert.equal(payments.length, 1);
  assert.deepEqual([payments[0]?.["method"], payments[0]?.["amount_minor"]], ["card", 12550]);
  assert.match(String(payments[0]?.["reference"]), /^a test page pay_test_page_\d+$/);
  const event = events(t.db).find((one) => one.action === "payment.paid-by-card");
  assert.equal(event?.actor ?? null, null, "no one in HQ recorded it");

  // The return address again, and the button again: still one payment.
  assert.equal(said(await stacy.get(`/portal/invoices/${id}/paid`), t, "done"), "Paid. Thank you.");
  assert.equal(said(await stacy.post(`/portal/invoices/${id}/pay`, {}), t, "problem"), "Nothing is owed on that invoice.");
  assert.equal(t.db.prepare("select count(*) as n from payment where invoice_id = ?").get(id)?.["n"], 1);
  assert.doesNotMatch(await stacy.page("/portal"), new RegExp(`action="/portal/invoices/${id}/pay"`), "a paid invoice has no button");
  assert.match(textOf(await admin.page(`/invoices/${id}`)), /Card[\s\S]*\$125\.50/);
  assert.match(textOf(await admin.page("/status")), /Card payments[\s\S]*Test mode/);
});

test("declined at the platform: back with words, nothing recorded, and it can be tried again", async () => {
  const { t, stacy } = w;
  const id = await w.bill("40", "Logo touch-up");
  await stacy.post(`/portal/invoices/${id}/pay`, {});
  const page = ((await stacy.get(`/portal/invoices/${id}/pay`)).headers.get("refresh") ?? "").slice("0;url=".length);
  await stacy.post(page, { answer: "decline" });
  assert.match(said(await stacy.get(`/portal/invoices/${id}/paid`), t, "problem"), /We haven’t received that payment/);
  assert.equal(t.services.finance.invoices.get(id)?.status, "sent");
  await stacy.post(page, { answer: "pay" });
  assert.equal(said(await stacy.get(`/portal/invoices/${id}/paid`), t, "done"), "Paid. Thank you.");
});

test("a part payment by check, then the rest by card: the card is asked for what is still owed", async () => {
  const { t, admin, stacy } = w;
  const id = await w.bill("100", "Hosting, a year");
  await admin.post(`/invoices/${id}/payments`, { amount: "30", method: "check", on: Temporal.Now.plainDateISO("America/New_York").toString(), reference: "1042" });
  await stacy.post(`/portal/invoices/${id}/pay`, {});
  const step = await stacy.get(`/portal/invoices/${id}/pay`);
  assert.match(textOf(await step.text()), /\$70\.00/);
  await stacy.post((step.headers.get("refresh") ?? "").slice("0;url=".length), { answer: "pay" });
  await stacy.get(`/portal/invoices/${id}/paid`);
  assert.deepEqual([t.services.finance.invoices.get(id)?.status, t.services.finance.invoices.get(id)?.paidMinor], ["paid", 10000]);
});

test("paid at the platform after the invoice was voided: not recorded, written down for Potomac, and said plainly", async () => {
  const { t, admin, stacy } = w;
  const id = await w.bill("15", "Stock photo");
  await stacy.post(`/portal/invoices/${id}/pay`, {});
  const page = ((await stacy.get(`/portal/invoices/${id}/pay`)).headers.get("refresh") ?? "").slice("0;url=".length);
  await admin.post(`/invoices/${id}/void`, {});
  assert.equal(t.services.finance.invoices.get(id)?.status, "void");
  await stacy.post(page, { answer: "pay" });
  assert.match(said(await stacy.get(`/portal/invoices/${id}/paid`), t, "problem"), /We received a payment, but couldn’t put it on this invoice/);
  assert.equal(t.db.prepare("select count(*) as n from payment where invoice_id = ?").get(id)?.["n"], 0);
  const noted = events(t.db).filter((one) => one.action === "payment.card-unmatched" && one.record === id);
  assert.equal(noted.length, 1);
  await stacy.get(`/portal/invoices/${id}/paid`);
  assert.equal(events(t.db).filter((one) => one.action === "payment.card-unmatched" && one.record === id).length, 1, "written down once");
});

test("another client can't start, see or settle someone else's invoice; signed out, the pay step is the sign-in form", async () => {
  const { t, stacy, grover } = w;
  const id = await w.bill("60", "Menu update");
  assert.equal(said(await grover.post(`/portal/invoices/${id}/pay`, {}), t, "problem"), "That invoice isn’t here.");
  await stacy.post(`/portal/invoices/${id}/pay`, {});
  const theirs = await grover.get(`/portal/invoices/${id}/pay`);
  assert.equal(theirs.status, 404);
  assert.equal(theirs.headers.get("refresh"), null);
  const nobody = await fetch(`${t.origin}/portal/invoices/${id}/pay`, { redirect: "manual" });
  assert.equal(nobody.status, 401);
  assert.equal(nobody.headers.get("refresh"), null);
  assert.equal(locationOf(await grover.post(`/portal/invoices/${id}/pay/told`, { told: "{}" })).includes("done="), false);
  assert.equal(t.services.finance.invoices.get(id)?.status, "sent");
});

test("the webhook address is refused for a platform that isn't the one set up, and for a form", async () => {
  const { t } = w;
  assert.equal((await fetch(`${t.origin}/pay/webhook/stripe`, { method: "POST", body: "{}" })).status, 400);
  assert.equal((await fetch(`${t.origin}/pay/webhook/../staff`, { method: "POST", body: "{}" })).status !== 200, true);
});

test("the settings: one name, its keys, and plain words when they can't be used", () => {
  assert.equal(cardPayConfigFrom({}, "https://hq.example"), null);
  assert.deepEqual(cardPayConfigFrom({ HQ_PAY_PROVIDER: "test" }, ""), { platform: "test", settings: {} });
  assert.deepEqual(cardPayConfigFrom({ HQ_PAY_PROVIDER: "stripe", HQ_PAY_STRIPE_KEY: "sk_x", HQ_PAY_STRIPE_WEBHOOK_SECRET: "whsec_x" }, "https://hq.example"), { platform: "stripe", settings: { stripe: { key: "sk_x", webhookSecret: "whsec_x" } } });
  assert.match(String(cardPayConfigFrom({ HQ_PAY_PROVIDER: "stripe" }, "https://hq.example")), /its keys \(HQ_PAY_STRIPE_\*\) are not all set/);
  assert.match(String(cardPayConfigFrom({ HQ_PAY_PROVIDER: "venmo" }, "https://hq.example")), /It can be stripe, square, paypal, helcim or test/);
  assert.match(String(cardPayConfigFrom({ HQ_PAY_PROVIDER: "stripe", HQ_PAY_STRIPE_KEY: "sk_x" }, "http://localhost:3000")), /need HQ_PUBLIC_URL to be HQ's https address/);
  const square = cardPayConfigFrom({ HQ_PAY_PROVIDER: "square", HQ_PAY_SQUARE_TOKEN: "t", HQ_PAY_SQUARE_LOCATION: "L" }, "https://hq.example");
  assert.equal(typeof square === "object" && square?.settings["square"]?.["webhookUrl"], "https://hq.example/pay/webhook/square");
});

test("with Stripe set up: a Checkout Session for what is owed, and the signed webhook alone records the payment", async () => {
  const session = { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1", payment_status: "unpaid", status: "open", amount_total: 0, currency: "usd", payment_intent: "pi_1" };
  const sent: { url: string; body: string }[] = [];
  const stripeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: String(init?.body ?? "") });
    if ((init?.method ?? "GET") === "POST") session.amount_total = Number(new URLSearchParams(String(init?.body)).get("line_items[0][price_data][unit_amount]"));
    return new Response(JSON.stringify(session), { status: 200 });
  }) as typeof fetch;
  const s = await world({ publicUrl: "https://hq.example", cardPay: { platform: "stripe", settings: { stripe: { key: "sk_test_x", webhookSecret: "whsec_x" } } }, cardPayFetch: stripeFetch });
  try {
    const id = await s.bill("250");
    assert.match(textOf(await s.stacy.page("/portal")), /“Pay by card” takes you to Stripe’s secure page to pay\. Potomac Solutions never sees your card number\./);
    await s.stacy.post(`/portal/invoices/${id}/pay`, {});
    const asked = new URLSearchParams(sent[0]?.body);
    assert.equal(sent[0]?.url, "https://api.stripe.com/v1/checkout/sessions");
    assert.deepEqual([asked.get("line_items[0][price_data][unit_amount]"), asked.get("success_url"), asked.get("cancel_url")], ["25000", `https://hq.example/portal/invoices/${id}/paid`, "https://hq.example/portal#invoices"]);
    assert.match(asked.get("line_items[0][price_data][product_data][name]") ?? "", /^Potomac Solutions invoice INV-\d{4}$/);
    const step = await s.stacy.get(`/portal/invoices/${id}/pay`);
    assert.equal(step.headers.get("refresh"), "0;url=https://checkout.stripe.com/c/pay/cs_test_1");
    assert.match(textOf(await step.text()), /You pay on Stripe’s secure page[\s\S]*Continue to Stripe/);

    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_test_1" } } });
    const stamp = String(Math.floor(Date.now() / 1000));
    const sign = (secret: string) => `t=${stamp},v1=${createHmac("sha256", secret).update(`${stamp}.${body}`).digest("hex")}`;
    const hook = (signature: string) => fetch(`${s.t.origin}/pay/webhook/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body });

    // A webhook nobody signed, and one signed before the money came: nothing recorded.
    assert.equal((await hook(sign("whsec_someone_else"))).status, 400);
    assert.equal((await hook(sign("whsec_x"))).status, 200);
    assert.equal(s.t.services.finance.invoices.get(id)?.status, "sent", "the webhook is a reason to ask Stripe, and Stripe says unpaid");

    // The client pays and closes the tab: the webhook is all HQ hears.
    session.payment_status = "paid";
    assert.equal((await hook(sign("whsec_x"))).status, 200);
    assert.deepEqual([s.t.services.finance.invoices.get(id)?.status, s.t.services.finance.invoices.get(id)?.paidMinor], ["paid", 25000]);
    assert.equal((await hook(sign("whsec_x"))).status, 200);
    const payments = s.t.db.prepare("select reference from payment where invoice_id = ?").all(id);
    assert.deepEqual(payments.map((row) => row["reference"]), ["Stripe pi_1"]);
    assert.match(textOf(await s.admin.page("/status")), /Card payments[\s\S]*through Stripe/);
  } finally {
    await s.t.stop();
  }
});

test("with Helcim set up: its frame on a page of HQ's, only Helcim's addresses let in, and its answer believed only with its hash", async () => {
  const { createHash } = await import("node:crypto");
  const helcimFetch = (async () => new Response(JSON.stringify({ checkoutToken: "chk_1", secretToken: "sec_1" }), { status: 200 })) as typeof fetch;
  const h = await world({ publicUrl: "https://hq.example", cardPay: { platform: "helcim", settings: { helcim: { token: "api_x" } } }, cardPayFetch: helcimFetch });
  try {
    const id = await h.bill("90");
    await h.stacy.post(`/portal/invoices/${id}/pay`, {});
    assert.equal((await h.stacy.get(`/portal/invoices/${id}/pay`)).headers.get("refresh"), `0;url=/portal/invoices/${id}/pay/frame`);
    const frame = await h.stacy.get(`/portal/invoices/${id}/pay/frame`);
    assert.equal(frame.status, 200);
    const policy = frame.headers.get("content-security-policy") ?? "";
    const nonce = /script-src 'nonce-([^']+)'/.exec(policy)?.[1] ?? "";
    assert.ok(nonce.length >= 16);
    assert.match(policy, /script-src 'nonce-[^']+' https:\/\/secure\.helcim\.app;/);
    assert.match(policy, /frame-src https:\/\/secure\.helcim\.app;/);
    assert.match(policy, /form-action 'self'/);
    const html = await frame.text();
    assert.ok(html.includes(`<script nonce="${nonce}" src="https://secure.helcim.app/helcim-pay/services/start.js">`));
    assert.ok(html.includes(`action="/portal/invoices/${id}/pay/told"`));
    assert.equal(html.includes("sec_1"), false, "Helcim's secret never reaches the page");
    assert.equal(locationOf(await h.grover.get(`/portal/invoices/${id}/pay/frame`)).startsWith("/portal"), true, "someone else's invoice has no frame");

    const data = { transactionId: "20163175", status: "APPROVED", amount: "90.00", currency: "USD" };
    const hash = (secret: string) => createHash("sha256").update(JSON.stringify(data) + secret).digest("hex");
    const forged = await h.stacy.post(`/portal/invoices/${id}/pay/told`, { ref: "chk_1", told: JSON.stringify({ data, hash: hash("guessed") }) });
    assert.match(said(forged, h.t, "problem"), /We haven’t received that payment/);
    assert.equal(h.t.services.finance.invoices.get(id)?.status, "sent");
    const real = await h.stacy.post(`/portal/invoices/${id}/pay/told`, { ref: "chk_1", told: JSON.stringify({ data, hash: hash("sec_1") }) });
    assert.equal(said(real, h.t, "done"), "Paid. Thank you.");
    assert.deepEqual(h.t.db.prepare("select reference, amount_minor from payment where invoice_id = ?").all(id).map((row) => [row["reference"], row["amount_minor"]]), [["Helcim 20163175", 9000]]);
  } finally {
    await h.t.stop();
  }
});
