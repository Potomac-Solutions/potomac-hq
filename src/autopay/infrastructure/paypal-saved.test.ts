import assert from "node:assert/strict";
import { test } from "node:test";
import { paypalSavedPay } from "./paypal-saved.ts";

type Seen = { url: string; method: string; body: any; key: string | undefined };
function fakePayPal(answers: Record<string, (body: any) => [number, unknown]>) {
  const seen: Seen[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const headers = (init.headers ?? {}) as Record<string, string>;
    if (path === "/v1/oauth2/token") return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    const body = init.body ? JSON.parse(init.body as string) : null;
    seen.push({ url: path, method: init.method ?? "GET", body, key: headers["paypal-request-id"] });
    const answer = answers[`${init.method} ${path}`];
    if (!answer) return new Response("{}", { status: 404 });
    const [status, json] = answer(body);
    return new Response(status === 204 ? null : JSON.stringify(json), { status });
  }) as typeof fetch;
  return { seen, saved: paypalSavedPay({ client: "c", secret: "s", api: "https://paypal.test" }, { fetch: fetcher }) };
}

test("saves an account without a purchase: a setup token to approve, then a payment token", async () => {
  const { seen, saved } = fakePayPal({
    "POST /v3/vault/setup-tokens": () => [201, { id: "SETUP1", links: [{ rel: "approve", href: "https://paypal.test/agreements/approve?token=SETUP1" }] }],
    "POST /v3/vault/payment-tokens": () => [201, { id: "PT1", customer: { id: "C1" }, payment_source: { paypal: { email_address: "bob@feed.example" } } }],
  });
  assert.deepEqual(await saved.begin({ key: "k", back: "https://hq/portal/autopay/done", cancel: "https://hq/portal/autopay/cancelled" }), { ok: true, setup: "SETUP1", url: "https://paypal.test/agreements/approve?token=SETUP1" });
  assert.equal(seen[0]?.body.payment_source.paypal.usage_type, "MERCHANT");
  assert.equal(seen[0]?.body.payment_source.paypal.experience_context.return_url, "https://hq/portal/autopay/done");
  assert.deepEqual(await saved.keep("SETUP1"), { ok: true, token: "PT1", label: "PayPal (bob@feed.example)" });
  assert.deepEqual(seen[1]?.body, { payment_source: { token: { id: "SETUP1", type: "SETUP_TOKEN" } } });
});

test("charges the saved account with an order on its vault_id, keyed so a repeat is the same charge", async () => {
  const { seen, saved } = fakePayPal({
    "POST /v2/checkout/orders": () => [201, { id: "O1", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP1", status: "COMPLETED" }] } }] }],
  });
  assert.deepEqual(await saved.charge({ token: "PT1", key: "autopay:inv:4900:2026-12-01", cents: 4900, currency: "USD", description: "Potomac Solutions invoice INV-0003" }), { outcome: "paid", reference: "CAP1" });
  assert.deepEqual(seen[0]?.body.payment_source, { paypal: { vault_id: "PT1" } });
  assert.deepEqual(seen[0]?.body.purchase_units[0].amount, { currency_code: "USD", value: "49.00" });
  assert.equal(seen[0]?.key, "autopay:inv:4900:2026-12-01");
});

test("an approved order is captured; a refusal is declined; a server error is unclear", async () => {
  const approved = fakePayPal({
    "POST /v2/checkout/orders": () => [201, { id: "O2", status: "APPROVED" }],
    "POST /v2/checkout/orders/O2/capture": () => [201, { id: "O2", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP2", status: "COMPLETED" }] } }] }],
  });
  assert.deepEqual(await approved.saved.charge({ token: "PT1", key: "k", cents: 100, currency: "usd", description: "x" }), { outcome: "paid", reference: "CAP2" });
  const refused = fakePayPal({ "POST /v2/checkout/orders": () => [422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] }] });
  assert.deepEqual(await refused.saved.charge({ token: "PT1", key: "k", cents: 100, currency: "usd", description: "x" }), { outcome: "declined", reason: "INSTRUMENT_DECLINED" });
  const broken = fakePayPal({ "POST /v2/checkout/orders": () => [503, {}] });
  assert.deepEqual(await broken.saved.charge({ token: "PT1", key: "k", cents: 100, currency: "usd", description: "x" }), { outcome: "unknown", reason: "paypal-http-503" });
  const forget = fakePayPal({ "DELETE /v3/vault/payment-tokens/PT1": () => [204, null] });
  assert.equal(await forget.saved.forget("PT1"), true);
});
