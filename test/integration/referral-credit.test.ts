// Referral credit (decision 0010, slice 8) over real HTTP: a client gets
// their own link and sees it in the portal; an inquiry by it is marked as
// referred by them; when the new client pays, the referrer earns credit; the
// credit comes off one of the referrer's draft invoices, never all of it;
// what a referral earns can be changed; and someone typed in by name.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import * as finance from "../../src/finance/index.ts";
import { earnCredits } from "../../src/referral-credit/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, httpClient, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let moats: { client: { id: Id }; project: { id: Id } };
const query = (res: Response, name: string) => new URL(res.headers.get("location") ?? "", "http://x").searchParams.get(name) ?? "";
const today = () => Temporal.Now.plainDateISO("America/New_York").toString();

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: "https://hq.example" });
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  moats = await wonProject(t.services, mikeyId, { client: "Moats Hardware", title: "Website plan", pricing: "monthly", amount: "50" });
});
after(() => t.stop());

test("a client gets their own link, named for them, and sees it in their portal", async () => {
  assert.equal(query(await sam.post(`/clients/${moats.client.id}/referral-link`, {}), "problem"), "You don’t have permission to do that.");
  assert.equal(query(await mikey.post(`/clients/${moats.client.id}/referral-link`, {}), "done"), "Made. Their link ends in /r/moats-hardware; they’ll see it in their portal.");
  assert.equal(query(await mikey.post(`/clients/${moats.client.id}/referral-link`, {}), "problem"), "This client already has their own link.");
  assert.match(textOf(await mikey.page(`/clients/${moats.client.id}`)), /Referrals Their own link: https:\/\/hq\.example\/r\/moats-hardware/);
  const rita = await clientSignedIn(t, mikey, moats.client.id, "Rita Moats", "rita@example.com");
  assert.match(textOf(await rita.page("/portal")), /Send a friend our way .* you get \$25\.00 off your next one\. https:\/\/hq\.example\/r\/moats-hardware/);
});

test("an inquiry that came by their link is marked as referred by them", async () => {
  const scan = await fetch(`${t.origin}/r/moats-hardware`, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (iPhone)" } });
  assert.equal(scan.headers.get("location"), "https://potomac.solutions/?ref=moats-hardware");
  await httpClient(t.origin).post("/contact", { name: "Dale Pruitt", email: "dale@example.com", business: "Pruitt Farm Stand", message: "Rita said you built her site", ref: "moats-hardware" });
  const opportunity = t.db.prepare("select id, referred_by_org from opportunity where title like '%Rita said%'").get() as { id: string; referred_by_org: string };
  assert.equal(opportunity.referred_by_org, moats.client.id);
  assert.match(textOf(await mikey.page(`/opportunities/${opportunity.id}`)), /Referred by Moats Hardware/);
});

test("when the referred client pays, the referrer earns credit, once; it comes off a draft, never all of it", async () => {
  const pruitt = t.db.prepare("select organization_id from opportunity where title like '%Rita said%'").get()?.["organization_id"] as Id;
  // Pruitt becomes a client with a paid invoice.
  const opportunity = t.db.prepare("select id from opportunity where organization_id = ?").get(pruitt)?.["id"] as Id;
  t.db.prepare("update opportunity set service = 'website' where id = ?").run(opportunity);
  for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(t.services.crm, mikeyId, opportunity, { to }));
  unwrap(crm.setOpportunityValue(t.services.crm, mikeyId, opportunity, { pricing: "fixed", amount: "600" }));
  for (const to of ["quoted", "won"]) unwrap(crm.moveOpportunity(t.services.crm, mikeyId, opportunity, { to }));
  const project = unwrap(crm.convertOpportunity(t.services.crm, mikeyId, opportunity));
  assert.equal(earnCredits(t.services.referralCredit), 0, "nothing until they pay");
  const invoice = unwrap(finance.createInvoice(t.services.finance, mikeyId, project.id, { kind: "full", description: "Farm stand site", amount: "600" }));
  unwrap(finance.sendInvoiceNow(t.services.finance, mikeyId, invoice.id));
  unwrap(finance.recordPayment(t.services.finance, mikeyId, invoice.id, { amount: "600", method: "check", on: today() }));
  assert.equal(earnCredits(t.services.referralCredit), 1);
  assert.equal(earnCredits(t.services.referralCredit), 0, "once");
  assert.match(textOf(await mikey.page(`/clients/${moats.client.id}`)), /Credit earned \$25\.00, used \$0\.00, \$25\.00 left/);

  const draft = unwrap(finance.createInvoice(t.services.finance, mikeyId, moats.project.id, { kind: "other", description: "Website plan, December", amount: "20" }));
  assert.match(textOf(await mikey.page(`/invoices/${draft.id}`)), /Take \$19\.00 of referral credit off/, "all but the last dollar");
  assert.equal(query(await mikey.post(`/invoices/${draft.id}/referral-credit`, {}), "done"), "Took $19.00 of referral credit off.");
  assert.equal(t.db.prepare("select total_minor from invoice where id = ?").get(draft.id)?.["total_minor"], 100);
  assert.match(textOf(await mikey.page(`/clients/${moats.client.id}`)), /used \$19\.00, \$6\.00 left/);
  assert.equal(query(await mikey.post(`/invoices/${draft.id}/referral-credit`, {}), "problem"), "There’s no credit to take off this invoice.");
  assert.equal(query(await sam.post(`/invoices/${draft.id}/referral-credit`, {}), "problem"), "You don’t have permission to do that.");
});

test("what a referral earns can be changed; someone who isn't a client is typed in; a client can't refer themselves", async () => {
  assert.equal(query(await mikey.post("/referral-credit", { amount: "0.50" }), "problem"), "A referral is worth between $1 and $1,000, like 25.");
  assert.equal(query(await mikey.post("/referral-credit", { amount: "30" }), "done"), "Each referral now earns $30.00 of credit.");
  assert.match(await mikey.page("/referrals"), /name="amount"[^>]*value="30\.00"/);
  const shrout = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Shrout Feed" })).id;
  const lead = unwrap(crm.createOpportunity(t.services.crm, mikeyId, shrout, { title: "Feed store site", leadSource: "word-of-mouth" })).id;
  assert.equal(query(await sam.post(`/opportunities/${lead}/referred-by`, { organizationId: "", name: "Dale at the feed store" }), "done"), "Saved.");
  assert.match(textOf(await mikey.page(`/opportunities/${lead}`)), /Referred by Dale at the feed store/);
  assert.equal(query(await mikey.post(`/opportunities/${lead}/referred-by`, { organizationId: shrout, name: "" }), "problem"), "A client can’t refer themselves.");
});
