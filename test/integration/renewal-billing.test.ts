// Billing a client for a renewal, over real HTTP. Potomac bills a domain from
// the client's page: one invoice, sent, due a week before the domain renews.
// The client sees it coming up in their portal with the day to pay by, and
// the invoice waiting on them. Paid, it says so; renewed, the next term isn't
// billed yet. Billed late, it is due at once, and both sides are told it
// wasn't paid in time.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as finance from "../../src/finance/index.ts";
import * as renewals from "../../src/renewals/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, events, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
let stacy: Client;
let mikey: Id;
let clientId: Id;
let projectId: Id;
const today = Temporal.Now.plainDateISO("America/New_York");
const day = (days: number) => today.add({ days }).toString();
const longDay = (date: string) => Temporal.PlainDate.from(date).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" });
const problemOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("done") ?? "";
const renewal = (id: Id) => t.services.renewals.renewals.get(id);

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  member = await signIn(t, "sam@example.com", "Sam Teter", ["member"]);
  await member.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const won = await wonProject(t.services, mikey, { client: "Better Days Towing", title: "Website rebuild" });
  clientId = won.client.id;
  projectId = won.project.id;
  stacy = await clientSignedIn(t, admin, clientId, "Stacy Roberts", "stacy@betterdays.example");
});
after(() => t.stop());

test("the domain is billed from the client's page: one invoice, sent, due a week before it renews", async () => {
  const domain = unwrap(renewals.addRenewal(t.services.renewals, mikey, clientId, { kind: "domain", name: "betterdaystowing.com", provider: "Namecheap", renewsOn: day(20), termMonths: "12", cost: "11.28", price: "20" }));
  const page = textOf(await admin.page(`/clients/${clientId}`));
  assert.match(page, new RegExp(`Not billed yet\\. The client pays by ${longDay(day(13))}, a week before it renews\\.`));

  assert.equal(problemOf(await member.post(`/renewals/${domain.id}/bill`, { projectId })), "You don’t have permission to do that.", "a member can't send invoices");
  assert.equal(problemOf(await admin.post(`/renewals/${domain.id}/bill`, { projectId: "" })), "Choose the project the invoice goes on. A client with no project needs one first: an ongoing one for their plan works.");
  assert.equal(doneOf(await admin.post(`/renewals/${domain.id}/bill`, { projectId, back: "client", clientId })), "Billed. The invoice is in the client’s portal, due a week before it renews.");

  const billed = renewal(domain.id);
  assert.ok(billed?.invoiceId);
  assert.equal(billed.billedFor, day(20));
  const invoice = t.services.finance.invoices.get(billed.invoiceId);
  assert.equal(invoice?.status, "sent");
  assert.equal(invoice?.dueOn, day(13));
  assert.equal(invoice?.total.minor, 2000);
  assert.match(invoice?.lines[0]?.description ?? "", /^betterdaystowing\.com: domain renewal from .+ \(every year\)$/);
  assert.equal(invoice?.projectId, projectId);
  assert.deepEqual(events(t.db).filter((event) => event.record === domain.id).map((event) => event.action), ["renewal.added", "renewal.billed"]);
  assert.equal(problemOf(await admin.post(`/renewals/${domain.id}/bill`, { projectId })), "This renewal is already billed for its coming term.");
  assert.match(textOf(await admin.page("/renewals")), new RegExp(`INV-0001 sent\\. The client pays by ${longDay(day(13))}\\.`));
});

test("the client sees it coming up, with the day to pay by, and the invoice waiting on them", async () => {
  const home = textOf(await stacy.page("/portal"));
  assert.match(home, /Coming up for renewal/);
  assert.match(home, new RegExp(`betterdaystowing\\.com · Domain Renews ${longDay(day(20))} ?\\. \\$20\\.00\\. Please pay INV-0001 by ${longDay(day(13))}, a week before it renews, so we know to renew it\\.`));
  assert.match(home, /Pay invoice INV-0001: \$20\.00/);
  assert.doesNotMatch(home, /11\.28/, "what it costs Potomac is never shown");
});

test("paid, both sides are told; renewed, the next term isn't billed yet", async () => {
  const domain = t.services.renewals.renewals.listFor(clientId)[0];
  assert.ok(domain?.invoiceId);
  unwrap(finance.recordPayment(t.services.finance, mikey, domain.invoiceId, { amount: "20", method: "check", on: today.toString(), reference: "1042" }));
  assert.match(textOf(await stacy.page("/portal")), /Paid, thank you\. We’ll renew it before it runs out\./);
  assert.match(textOf(await admin.page(`/clients/${clientId}`)), /Paid INV-0001 is paid\. Renew it\./);
  assert.equal(doneOf(await admin.post(`/renewals/${domain.id}/renewed`, {})), "Marked renewed. Its next date moved on.");
  const next = renewal(domain.id);
  assert.equal(next?.renewsOn, today.add({ days: 20 }).add({ months: 12 }).toString());
  assert.doesNotMatch(textOf(await stacy.page("/portal")), /betterdaystowing\.com/, "a year away and nothing owed: not shown");
  assert.match(textOf(await admin.page(`/clients/${clientId}`)), /Not billed yet\./);
});

test("billed after its pay-by day, it is due at once, and both sides are told it wasn't paid in time", async () => {
  const hosting = unwrap(renewals.addRenewal(t.services.renewals, mikey, clientId, { kind: "hosting", name: "Netlify hosting", renewsOn: day(3), termMonths: "1", price: "9" }));
  assert.equal(doneOf(await admin.post(`/renewals/${hosting.id}/bill`, { projectId })), "Billed. The invoice is in the client’s portal, due a week before it renews.");
  const invoiceId = renewal(hosting.id)?.invoiceId;
  assert.ok(invoiceId);
  assert.equal(t.services.finance.invoices.get(invoiceId)?.dueOn, today.toString(), "already past its pay-by day: due today");
  assert.match(textOf(await admin.page("/renewals")), new RegExp(`Not paid INV-0002 wasn’t paid by ${longDay(day(-4))}\\. Decide whether to renew it or let it lapse\\.`));
  assert.match(textOf(await stacy.page("/portal")), /Please pay INV-0002 as soon as you can, or tell us if you’d like to let it go\./);
});

test("a renewal Potomac doesn't bill for is not shown to the client and can't be billed", async () => {
  const ours = unwrap(renewals.addRenewal(t.services.renewals, mikey, clientId, { kind: "ssl", name: "Certificate", renewsOn: day(10), termMonths: "12", cost: "0" }));
  assert.equal(problemOf(await admin.post(`/renewals/${ours.id}/bill`, { projectId })), "Set what we bill for it first. A renewal with no price is ours to pay.");
  assert.doesNotMatch(textOf(await stacy.page("/portal")), /Certificate/);
});
