// Giving money back (2026-11-26): by hand, or through the payment platform
// for a card payment that came through it. The invoice's paid amount, its
// status, the books and the weekly figures all follow.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, events, signIn, testApp, textOf, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let stacy: Client;
let clientId: Id;
const today = () => Temporal.Now.plainDateISO("America/New_York").toString();
const locationOf = (res: Response) => res.headers.get("location") ?? "";
const said = (res: Response, name: "done" | "problem") => new URL(locationOf(res), t.origin).searchParams.get(name) ?? "";
const bill = async (amount: string, description: string) => /\/invoices\/([0-9a-f-]{36})/.exec(locationOf(await admin.post(`/clients/${clientId}/invoices`, { kind: "other", description, amount, send: "on" })))?.[1] as Id;
const paymentsOf = (invoiceId: Id) => t.db.prepare("select id, method, amount_minor from payment where invoice_id = ? order by rowid").all(invoiceId) as { id: Id; method: string; amount_minor: number }[];

before(async () => {
  t = await testApp({ cardPay: { platform: "test", settings: {} } });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const won = await wonProject(t.services, mikey, { client: "Better Days Towing", title: "Website rebuild" });
  clientId = won.client.id;
  stacy = await clientSignedIn(t, admin, clientId, "Stacy Roberts", "stacy@betterdays.example");
});
after(() => t.stop());

test("a check payment refunded in part, by hand: owed again by that much, and the books show it going out", async () => {
  const id = await bill("100", "Hosting, a year");
  await admin.post(`/invoices/${id}/payments`, { amount: "100", method: "check", on: today(), reference: "1042" });
  assert.equal(t.services.finance.invoices.get(id)?.status, "paid");
  const [payment] = paymentsOf(id);
  const page = textOf(await admin.page(`/invoices/${id}`));
  assert.match(page, /Refund the \$100\.00 check payment of/);
  assert.match(page, /Give the money back yourself first/, "a check can't be refunded through the platform");

  assert.equal(said(await admin.post(`/payments/${payment?.id}/refund`, { invoice: id, amount: "150", on: today() }), "problem"), "That’s more than is left of this payment to give back.");
  assert.equal(said(await admin.post(`/payments/${payment?.id}/refund`, { invoice: id, amount: "25", on: today(), reason: "Moved to a cheaper plan", reference: "check 1077" }), "done"), "Refund recorded. The invoice is owed again by what was given back, and the client sees it to pay in their portal.");
  const invoice = t.services.finance.invoices.get(id);
  assert.deepEqual([invoice?.status, invoice?.paidMinor], ["sent", 7500]);
  const after = textOf(await admin.page(`/invoices/${id}`));
  assert.match(after, /\$25\.00 refunded/);
  assert.match(after, /Given back[\s\S]*\$25\.00, by hand \(check 1077\)\. Moved to a cheaper plan/);
  assert.match(after, /What changed here[\s\S]*gave money back on an invoice/);
  const csv = await (await admin.get("/exports/payments.csv")).text();
  assert.match(csv, /-25,USD/);
  assert.equal(events(t.db).filter((one) => one.action === "payment.refunded").length, 1);
});

test("refunded and no longer owed: written off with the reason; a reason is needed", async () => {
  const id = await bill("60", "Logo touch-up");
  await admin.post(`/invoices/${id}/payments`, { amount: "60", method: "cash", on: today() });
  const [payment] = paymentsOf(id);
  // The form asks, and "no, it's theirs to keep" is the answer already picked: a refund isn't billed again by default.
  const form = await admin.page(`/invoices/${id}`);
  assert.match(form, /name="owed" value="no" checked/);
  assert.match(textOf(form), /Do they owe it again\? No, it’s theirs to keep: a refund\.[\s\S]*Yes: the payment didn’t stand \(a bounced check, a dispute\)/);
  const other = await bill("40", "Hosting, a month");
  await admin.post(`/invoices/${other}/payments`, { amount: "40", method: "check", on: today() });
  assert.match(said(await admin.post(`/payments/${paymentsOf(other)[0]?.id}/refund`, { invoice: other, amount: "40", on: today(), reason: "Check bounced", owed: "again" }), "done"), /owed again by what was given back/);
  assert.equal(t.services.finance.invoices.get(other)?.status, "sent");
  assert.equal(said(await admin.post(`/payments/${payment?.id}/refund`, { invoice: id, amount: "60", on: today(), owed: "no" }), "problem"), "Say why it’s being given back: it goes on the invoice.");
  assert.equal(said(await admin.post(`/payments/${payment?.id}/refund`, { invoice: id, amount: "60", on: today(), noLongerOwed: "on" }), "problem"), "Say why it’s being given back: it goes on the invoice.");
  assert.equal(said(await admin.post(`/payments/${payment?.id}/refund`, { invoice: id, amount: "60", on: today(), reason: "Work cancelled", noLongerOwed: "on" }), "done"), "Refund recorded. They don’t owe it again: the invoice is closed, written off for what was given back.");
  const invoice = t.services.finance.invoices.get(id);
  assert.deepEqual([invoice?.status, invoice?.paidMinor, invoice?.writtenOffNote], ["void", 0, "Work cancelled"]);
  assert.doesNotMatch(textOf(await admin.page(`/invoices/${id}`)), /Refund the \$60\.00/, "nothing left to give back");
  assert.doesNotMatch(await stacy.page("/portal"), new RegExp(`/portal/invoices/${id}/pay`), "the client isn't asked for it");
});

test("a card payment through the platform is refunded through it; a second refund can't pass what was paid", async () => {
  const id = await bill("80", "Menu update");
  await stacy.post(`/portal/invoices/${id}/pay`, {});
  const page = ((await stacy.get(`/portal/invoices/${id}/pay`)).headers.get("refresh") ?? "").slice("0;url=".length);
  await stacy.post(page, { answer: "pay" });
  await stacy.get(`/portal/invoices/${id}/paid`);
  const [payment] = paymentsOf(id);
  assert.equal(payment?.method, "card");
  assert.match(textOf(await admin.page(`/invoices/${id}`)), /Refund it through a test page: HQ asks them/);

  const done = await admin.post(`/payments/${payment?.id}/refund`, { invoice: id, how: "platform", amount: "30", on: today(), reason: "Partial: one page dropped" });
  assert.equal(said(done, "done"), "Refunded through a test page. The client gets the money back from them.");
  const refund = t.db.prepare("select through, reference, amount_minor from payment_refund where payment_id = ?").get(payment?.id as Id);
  assert.equal(refund?.["through"], "platform");
  assert.match(String(refund?.["reference"]), /^a test page refund_pay_test_page_\d+$/);
  assert.equal(t.services.finance.invoices.get(id)?.paidMinor, 5000);
  assert.equal(said(await admin.post(`/payments/${payment?.id}/refund`, { invoice: id, how: "platform", amount: "60", on: today() }), "problem"), "That’s more than is left of this payment to give back.");
  assert.equal(t.db.prepare("select count(*) as n from payment_refund where payment_id = ?").get(payment?.id as Id)?.["n"], 1, "nothing recorded when refused");
});

test("asking the platform for a payment that didn't come through it is refused in words; a member can't refund", async () => {
  const id = await bill("40", "Stock photo");
  await admin.post(`/invoices/${id}/payments`, { amount: "40", method: "card", on: today(), reference: "Square 991" });
  const [payment] = paymentsOf(id);
  assert.match(said(await admin.post(`/payments/${payment?.id}/refund`, { invoice: id, how: "platform", amount: "40", on: today() }), "problem"), /didn’t come through the payment platform/);
  const sam = await signIn(t, "sam@example.com", "Sam Teter", ["member"]);
  assert.equal(said(await sam.post(`/payments/${payment?.id}/refund`, { invoice: id, amount: "40", on: today() }), "problem"), "You don’t have permission to do that.");
  assert.equal(t.db.prepare("select count(*) as n from payment_refund where payment_id = ?").get(payment?.id as Id)?.["n"], 0);
});
