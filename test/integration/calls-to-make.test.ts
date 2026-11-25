// Calls to make (decision 0009, slice 4) against a real database and over
// real HTTP: the list on Today, one line per client with every reason, each
// only for those who may see it; calling from it and coming back; trying
// again after a voicemail; and the voicemail script.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let diner: Id;
let shop: Id;
let feed: Id;
let shopDeal: Id;
const query = (res: Response, name: string) => new URL("http://x" + (res.headers.get("location") ?? "")).searchParams.get(name) ?? "";
const callIn = (res: Response) => new URL("http://x" + (res.headers.get("location") ?? "")).pathname.split("/")[2] ?? "";
const day = (days: number) => Temporal.Now.plainDateISO("America/New_York").add({ days }).toString();
const now = () => new Date().toISOString();
const todayPanel = async (who: Client) => (/Calls to make (.*?) (All clear|In order)/.exec(textOf(await who.page("/today")))?.[1] ?? "");

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;

  // Elk Diner: an invoice 10 days late, and they asked for a call in the portal.
  const won = await wonProject(t.services, mikeyId, { client: "Elk Diner", title: "Diner website" });
  diner = won.client.id;
  unwrap(crm.addContact(t.services.crm, mikeyId, diner, { name: "Rita Okafor", email: "rita@example.com", phone: "304-555-0111", isPrimary: true }));
  t.db.prepare("insert into invoice (id, project_id, number, kind, status, lines, total_minor, currency, issued_on, due_on, note, created_by, created_at, updated_at) values (?, ?, 7, 'full', 'sent', '[]', 80000, 'USD', ?, ?, '', ?, ?, ?)").run("00000000-0000-4000-8000-00000000c001", won.project.id, day(-40), day(-10), mikeyId, now(), now());
  t.db.prepare("insert into client_user (id, organization_id, name, email, status, invited_by, created_at, updated_at) values (?, ?, 'Rita Okafor', 'rita@example.com', 'invited', ?, ?, ?)").run("00000000-0000-4000-8000-00000000c002", diner, mikeyId, now(), now());
  t.db.prepare("insert into call_request (id, organization_id, client_user_id, wanted, note, status, created_at, updated_at) values (?, ?, ?, 'mornings', '', 'requested', ?, ?)").run("00000000-0000-4000-8000-00000000c003", diner, "00000000-0000-4000-8000-00000000c002", now(), now());

  // Hensley Body Shop: a follow-up 3 days overdue.
  shop = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Hensley Body Shop" })).id;
  const dale = unwrap(crm.addContact(t.services.crm, mikeyId, shop, { name: "Dale Hensley", phone: "304-555-0100", isPrimary: true }));
  shopDeal = unwrap(crm.createOpportunity(t.services.crm, mikeyId, shop, { title: "New website", leadSource: "referral", contactId: dale.id })).id;
  t.db.prepare("update opportunity set follow_up_on = ? where id = ?").run(day(-3), shopDeal);

  // Gormania Feed: an opportunity gone quiet for three weeks.
  feed = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Gormania Feed" })).id;
  unwrap(crm.addContact(t.services.crm, mikeyId, feed, { name: "Gus Gormania", phone: "304-555-0122", isPrimary: true }));
  const quiet = unwrap(crm.createOpportunity(t.services.crm, mikeyId, feed, { title: "Online orders", leadSource: "phone" })).id;
  t.db.prepare("update opportunity set updated_at = ?, created_at = ? where id = ?").run(new Date(Date.now() - 21 * 86_400_000).toISOString(), new Date(Date.now() - 21 * 86_400_000).toISOString(), quiet);
});
after(() => t.stop());

test("Today lists who to call, one line each with every reason, most pressing first", async () => {
  const panel = await todayPanel(mikey);
  assert.match(panel, /^Elk Diner They asked for a call: mornings INV-0007 is 10 days late: \$800\.00 Call Hensley Body Shop Follow-up on “New website”, 3 days overdue Call Gormania Feed “Online orders” is going cold: no contact in 21 days and no follow-up set Call$/);
  const sams = await todayPanel(sam);
  assert.doesNotMatch(sams, /INV-0007/, "no money for a member");
  assert.match(sams, /Elk Diner They asked for a call: mornings Call/);
});

test("calling from the list comes back to it; the client drops off; a voicemail tries again in two business days", async () => {
  const html = await mikey.page("/today");
  assert.match(html, /name="opportunityId" value="[0-9a-f-]{36}"[^]*?name="returnTo" value="\/today#calls-to-make"/);
  const id = callIn(await mikey.post("/phone", { opportunityId: shopDeal, returnTo: "/today#calls-to-make" }));
  const screen = textOf(await mikey.page(`/phone/${id}`));
  assert.match(screen, /If you get their voicemail Hi Dale, this is Mikey from Potomac Solutions, calling about New website\./);
  assert.match(screen, /End call, back to the list/);
  const ended = await mikey.post(`/phone/${id}/end`, { outcome: "voicemail" });
  assert.equal(new URL("http://x" + (ended.headers.get("location") ?? "")).pathname + new URL("http://x" + (ended.headers.get("location") ?? "")).hash, "/today#calls-to-make");
  const expected = (() => {
    let d = Temporal.Now.plainDateISO("America/New_York");
    for (let left = 2; left > 0; ) {
      d = d.add({ days: 1 });
      if (d.dayOfWeek <= 5) left -= 1;
    }
    return d.toString();
  })();
  assert.equal(t.db.prepare("select follow_up_on from opportunity where id = ?").get(shopDeal)?.["follow_up_on"], expected);
  const panel = await todayPanel(mikey);
  assert.doesNotMatch(panel, /Hensley Body Shop/);
  assert.match(panel, /1 called already today\./);
});

test("no answer at a client with no opportunity: a to-do to call again; a chosen day wins", async () => {
  const id = callIn(await mikey.post("/phone", { clientId: diner, returnTo: "/today#calls-to-make" }));
  const ended = await mikey.post(`/phone/${id}/end`, { outcome: "no-answer" });
  assert.match(query(ended, "done"), /Call ended and logged\. 1 to-do added\./);
  const todo = t.db.prepare("select title, due_on, organization_id from task where title like 'Call % again'").get() as Record<string, unknown>;
  assert.equal(todo["title"], "Call Rita Okafor again");
  assert.equal(todo["organization_id"], diner);
  assert.ok(String(todo["due_on"]) > day(0));
  // A follow-up day chosen by hand is kept.
  const other = callIn(await mikey.post("/phone", { clientId: feed }));
  const deal = t.db.prepare("select id from opportunity where organization_id = ?").get(feed)?.["id"] as string;
  await mikey.post(`/phone/${other}/end`, { outcome: "voicemail" });
  assert.equal(t.db.prepare("select follow_up_on from opportunity where id = ?").get(deal)?.["follow_up_on"], null, "a call at the client, not the opportunity, sets no follow-up");
  const onDeal = callIn(await mikey.post("/phone", { opportunityId: deal }));
  await mikey.post(`/phone/${onDeal}/end`, { outcome: "voicemail", followUpOn: "2027-02-01" });
  assert.equal(t.db.prepare("select follow_up_on from opportunity where id = ?").get(deal)?.["follow_up_on"], "2027-02-01");
  assert.match(await todayPanel(mikey), /All called today\. Nice work\./);
});

test("the voicemail script is changed with the guides", async () => {
  assert.match(textOf(await mikey.page("/call-guides")), /Voicemail script Shown on the call screen .* As HQ came\./);
  assert.match(textOf(await sam.page("/call-guides")), /Voicemail script .* Hi \{name\}, this is \{me\}/, "members read it");
  assert.equal(query(await sam.post("/call-guides/voicemail", { text: "Hi" }), "problem"), "You don’t have permission to do that.");
  assert.match(query(await mikey.post("/call-guides/voicemail", { text: "  " }), "problem"), /Write the script/);
  assert.match(query(await mikey.post("/call-guides/voicemail", { text: "x".repeat(601) }), "problem"), /under 600 characters/);
  assert.equal(query(await mikey.post("/call-guides/voicemail", { text: "Hey {name}, {me} here. Call me back about {about}." }), "done"), "Saved. Calls from now on use it.");
  const id = callIn(await mikey.post("/phone", { clientId: shop }));
  assert.match(textOf(await mikey.page(`/phone/${id}`)), /If you get their voicemail Hey Dale, Mikey here\. Call me back about your project\./);
  await mikey.post(`/phone/${id}/end`, { outcome: "no-answer" });
  assert.ok(t.db.prepare("select 1 from activity_event where action = 'call-script.changed'").get());
});
