// The inquiry form over real HTTP: from HQ's own /contact, and from a form on
// Potomac's website. Each lands in the CRM as a new opportunity from the
// website, and Potomac is emailed.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, httpClient, signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

type Sent = { to: string; subject: string; body: string };
const sent: Sent[] = [];
let t: TestApp;
let admin: Client;
const problemOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("problem") ?? "";
const opportunities = () => t.db.prepare("select o.title, o.lead_source, o.stage, o.summary, o.service, c.name as client from opportunity o join client_organization c on c.id = o.organization_id order by o.created_at").all() as { title: string; lead_source: string; stage: string; summary: string; service: string | null; client: string }[];
const SITE = "https://potomac.solutions";

before(async () => {
  t = await testApp({
    formOrigins: [SITE],
    inquiryEmail: "hello@potomac.solutions",
    publicUrl: "https://hq.example",
    email: { publicUrl: "https://hq.example", send: async (message) => (sent.push({ to: message.to, subject: message.subject, body: message.body }), { ok: true }) },
  });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
});
after(() => t.stop());

test("the form at /contact makes a client, its contact and a new opportunity, and emails Potomac", async () => {
  const visitor = httpClient(t.origin);
  const page = textOf(await visitor.page("/contact"));
  assert.match(page, /Tell us what you need .* Your name Your email A phone number \(optional\)/);
  assert.doesNotMatch(page, /Dashboard|Sign out/, "nothing of HQ");
  assert.equal(problemOf(await visitor.post("/contact", { name: "Rita", email: "rita@example.com", message: "" })), "Tell us a little about what you need.");
  const done = await visitor.post("/contact", { name: "Rita Okafor", email: "Rita@Example.com", phone: "304-555-0177", business: "Elk Diner", service: "website", message: "We need online orders for the diner. And maybe a menu page." });
  assert.equal(done.status, 303);
  assert.match(done.headers.get("location") ?? "", /^\/contact\/thanks\?done=/);
  assert.match(textOf(await visitor.page(done.headers.get("location") ?? "")), /Thanks ✓ Thanks\. We’ll be in touch within two business days\./);
  const [first] = opportunities();
  assert.deepEqual({ ...first }, { title: "Inquiry: We need online orders for the diner", lead_source: "website", stage: "new", summary: "We need online orders for the diner. And maybe a menu page.", service: "website", client: "Elk Diner" });
  assert.equal(sent[0]?.to, "hello@potomac.solutions");
  assert.equal(sent[0]?.subject, "Inquiry from Elk Diner");
  assert.match(sent[0]?.body ?? "", /rita@example\.com · 304-555-0177/);
  assert.match(sent[0]?.body ?? "", /In HQ: https:\/\/hq\.example\/opportunities\//);
  assert.match(textOf(await admin.page("/pipeline")), /Inquiry: We need online orders for the diner/);
  assert.ok(actions(t.db).includes("opportunity.inquiry-received"));
});

test("someone already in the CRM gets a new opportunity at their client, not a second client", async () => {
  await httpClient(t.origin).post("/contact", { name: "Rita Okafor", email: "rita@example.com", message: "Also: a gift card page?" });
  assert.equal(t.db.prepare("select count(*) as n from client_organization").get()?.["n"], 1);
  assert.equal(opportunities()[1]?.client, "Elk Diner");
  assert.match(sent.at(-1)?.body ?? "", /They're already in the CRM/);
});

test("a form on Potomac's website may post here and is sent back there; any other site is refused", async () => {
  const fromSite = await httpClient(t.origin).post("/contact", { name: "Dale Pruitt", email: "dale@example.com", message: "Farm stand website", return_to: `${SITE}/thanks` }, { origin: SITE });
  assert.equal(fromSite.status, 303);
  assert.match(fromSite.headers.get("location") ?? "", /^https:\/\/potomac\.solutions\/thanks\?done=Thanks/);
  assert.equal(opportunities().length, 3);
  const evil = await httpClient(t.origin).post("/contact", { name: "Eve", email: "eve@example.com", message: "hi" }, { origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  // The website's origin may post only the inquiry form, nothing else.
  assert.equal((await httpClient(t.origin).post("/book", { name: "Dale", email: "dale@example.com" }, { origin: SITE })).status, 403);
  // A return address on another site is ignored.
  const sneaky = await httpClient(t.origin).post("/contact", { name: "Dale Pruitt", email: "dale2@example.com", message: "Again", return_to: "https://evil.example/" });
  assert.match(sneaky.headers.get("location") ?? "", /^\/contact\/thanks/);
  assert.equal(opportunities().length, 4);
});

test("a bot that fills the hidden field gets thanks and nothing is made", async () => {
  const before = opportunities().length;
  const bot = await httpClient(t.origin).post("/contact", { name: "Bot", email: "bot@example.com", message: "Buy now", website: "http://spam.example" });
  assert.match(bot.headers.get("location") ?? "", /^\/contact\/thanks/);
  assert.equal(opportunities().length, before);
});
