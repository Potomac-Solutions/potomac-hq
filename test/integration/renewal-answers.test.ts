// Renewals asked of in time, answered by the client, and every invoice in
// one place (Mikey, 2026-11-25). Today says to bill a renewal from 30 days
// before it renews, so the bill goes out before the client's pay-by day. The
// client answers in their portal, renew it or let it lapse, and Potomac sees
// the answer on the client's page and on Today. Money → Invoices shows who
// owes what.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as finance from "../../src/finance/index.ts";
import * as renewals from "../../src/renewals/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, events, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let stacy: Client;
let mikey: Id;
let clientId: Id;
let otherClient: Id;
const today = Temporal.Now.plainDateISO("America/New_York");
const day = (days: number) => today.add({ days }).toString();
const problemOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("done") ?? "";
const renewal = (id: Id) => t.services.renewals.renewals.get(id);

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const won = await wonProject(t.services, mikey, { client: "Better Days Towing", title: "Website rebuild" });
  clientId = won.client.id;
  otherClient = (await wonProject(t.services, mikey, { client: "Moats Hardware", title: "Store site" })).client.id;
  stacy = await clientSignedIn(t, admin, clientId, "Stacy Roberts", "stacy@betterdays.example");
});
after(() => t.stop());

test("Today says to bill a renewal from 30 days out, before the client's pay-by day, and not after it's billed", async () => {
  const soon = unwrap(renewals.addRenewal(t.services.renewals, mikey, clientId, { kind: "domain", name: "betterdaystowing.com", renewsOn: day(25), termMonths: "12", cost: "15", price: "25" }));
  unwrap(renewals.addRenewal(t.services.renewals, mikey, clientId, { kind: "hosting", name: "Far-off hosting", renewsOn: day(90), termMonths: "12", price: "120" }));
  const page = textOf(await admin.page("/today"));
  assert.match(page, /Bill betterdaystowing\.com/);
  assert.match(page, /Bill it/);
  assert.doesNotMatch(page, /Far-off hosting/, "90 days out is too soon to bill");
  assert.match(await admin.page(`/clients/${clientId}`), new RegExp(`id="renewal-${soon.id}"`));
  unwrap(renewals.billRenewal(t.services.renewals, mikey, soon.id, { projectId: "" }));
  assert.doesNotMatch(textOf(await admin.page("/today")), /Bill betterdaystowing\.com/);
});

test("the client answers in the portal: let it lapse, then changes their mind; Potomac sees each answer", async () => {
  const email = unwrap(renewals.addRenewal(t.services.renewals, mikey, clientId, { kind: "email", name: "Business email", renewsOn: day(20), termMonths: "12", price: "60" }));
  const portal = await stacy.page("/portal");
  assert.match(portal, new RegExp(`action="/portal/renewals/${email.id}/answer"`));
  assert.match(textOf(portal), /Let it lapse/);

  assert.equal(doneOf(await stacy.post(`/portal/renewals/${email.id}/answer`, { choice: "lapse" })), "Got it. We won’t renew it, and we’ll let it lapse.");
  assert.deepEqual([renewal(email.id)?.answer?.choice, renewal(email.id)?.answer?.forTerm], ["lapse", day(20)]);
  assert.match(textOf(await stacy.page("/portal")), /You asked us to let it lapse\./);
  // Potomac sees it, isn't asked to bill it, and Today says to let it lapse.
  const client = textOf(await admin.page(`/clients/${clientId}`));
  assert.match(client, /The client asked us to let it lapse/);
  assert.match(textOf(await admin.page("/today")), /Let Business email lapse/);
  assert.doesNotMatch(textOf(await admin.page("/today")), /Bill Business email/);

  assert.equal(doneOf(await stacy.post(`/portal/renewals/${email.id}/answer`, { choice: "renew" })), "Thank you. We’ll renew it once it’s paid.");
  assert.match(textOf(await stacy.page("/portal")), /Thank you: we’ll renew it\./);
  assert.match(textOf(await admin.page("/today")), /Bill Business email[\s\S]*they asked us to renew it/);
  assert.deepEqual(events(t.db).filter((event) => event.record === email.id).map((event) => event.action), ["renewal.added", "renewal.client-said-lapse", "renewal.client-said-renew"]);

  // Renewed, the next term starts unanswered.
  unwrap(renewals.markRenewed(t.services.renewals, mikey, email.id));
  const after = unwrap(renewals.clientRenewals(t.services.renewals, mikey, clientId)).items.find((one) => one.id === email.id);
  assert.equal(after?.answer, null);
});

test("a client can't answer another client's renewal, a bad choice, or one already paid", async () => {
  const theirs = unwrap(renewals.addRenewal(t.services.renewals, mikey, otherClient, { kind: "domain", name: "moatshardware.com", renewsOn: day(15), termMonths: "12", price: "25" }));
  assert.equal(problemOf(await stacy.post(`/portal/renewals/${theirs.id}/answer`, { choice: "lapse" })), "That doesn’t exist.");
  assert.equal(renewal(theirs.id)?.answer, null);
  const ssl = unwrap(renewals.addRenewal(t.services.renewals, mikey, clientId, { kind: "ssl", name: "Certificate", renewsOn: day(15), termMonths: "12", price: "10" }));
  assert.equal(problemOf(await stacy.post(`/portal/renewals/${ssl.id}/answer`, { choice: "maybe" })), "Choose renew it, or let it lapse.");
  unwrap(renewals.billRenewal(t.services.renewals, mikey, ssl.id, { projectId: "" }));
  const invoiceId = renewal(ssl.id)?.invoiceId as Id;
  unwrap(finance.recordPayment(t.services.finance, mikey, invoiceId, { amount: "10", method: "cash", on: day(0) }));
  assert.equal(problemOf(await stacy.post(`/portal/renewals/${ssl.id}/answer`, { choice: "lapse" })), "That’s paid already, thank you. We’ll renew it.");
  // Signed out, nothing is recorded.
  await fetch(`${t.origin}/portal/renewals/${ssl.id}/answer`, { method: "POST", redirect: "manual", body: new URLSearchParams({ choice: "lapse" }) });
  assert.equal(renewal(ssl.id)?.answer, null);
});

test("Money → Invoices: who owes what, overdue and drafts, project or not", async () => {
  unwrap(finance.createClientInvoice(t.services.finance, mikey, otherClient, { kind: "other", description: "Domain transfer", amount: "20" }));
  const unpaid = textOf(await admin.page("/money/invoices"));
  assert.match(unpaid, /Owed to us/);
  assert.match(unpaid, /Who owes what[\s\S]*Better Days Towing/);
  assert.match(unpaid, /betterdaystowing\.com: domain renewal[\s\S]*\(no project\)/);
  const drafts = textOf(await admin.page("/money/invoices?show=drafts"));
  assert.match(drafts, /Domain transfer \(no project\)/);
  assert.match(drafts, /Moats Hardware/);
  assert.match(textOf(await admin.page("/money/invoices?show=paid")), /Certificate/);
  assert.match(textOf(await admin.page("/money")), /Invoices/);
  // The portal names a no-project invoice by what it's for.
  assert.match(textOf(await stacy.page("/portal")), /betterdaystowing\.com: domain renewal/);
});
