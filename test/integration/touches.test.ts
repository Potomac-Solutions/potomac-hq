// Logging calls and messages over real HTTP: on a client and on an
// opportunity, with how a call went, and the next follow-up set in one step.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let clientId: Id;
let opportunityId: Id;
let ritaId: Id;
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const inDays = (days: number) => Temporal.Now.plainDateISO("America/New_York").add({ days }).toString();

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  clientId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Elk Diner", sizeTier: "small" })).id;
  ritaId = unwrap(crm.addContact(t.services.crm, mikey, clientId, { name: "Rita Okafor", email: "rita@example.com", isPrimary: true })).id;
  opportunityId = unwrap(crm.createOpportunity(t.services.crm, mikey, clientId, { title: "Online orders", leadSource: "website" })).id;
});
after(() => t.stop());

test("a call that went to voicemail is logged on the opportunity, and sets the next follow-up", async () => {
  assert.match(textOf(await admin.page(`/opportunities/${opportunityId}`)), /Calls and messages No touches logged yet Start a call .* Log a call, email, text or meeting/);
  assert.equal(doneOf(await admin.post(`/opportunities/${opportunityId}/touches`, { kind: "call", outcome: "voicemail", contactId: ritaId, followUpOn: inDays(3) })), "Logged.");
  const page = textOf(await admin.page(`/opportunities/${opportunityId}`));
  assert.match(page, /Last touch .*: call, left a voicemail/);
  assert.match(page, /Call, left a voicemail with Rita Okafor Mikey Nichols,/);
  assert.equal(t.db.prepare("select follow_up_on from opportunity where id = ?").get(opportunityId)?.["follow_up_on"], inDays(3));
  assert.match(textOf(await admin.page("/")), /Follow-ups due|Online orders/);
});

test("a conversation needs a word about it; it shows on the client's timeline with its opportunity", async () => {
  assert.equal(problemOf(await admin.post(`/opportunities/${opportunityId}/touches`, { kind: "call", outcome: "reached" })), "Add a word about it: what was said, or what was sent.");
  await admin.post(`/opportunities/${opportunityId}/touches`, { kind: "call", outcome: "reached", note: "Wants a quote by Friday, 40 menu items." });
  await admin.post(`/clients/${clientId}/touches`, { kind: "email", note: "Sent the menu mock-up." });
  const page = textOf(await admin.page(`/clients/${clientId}`));
  assert.match(page, /Calls and messages Last touch .*: email/);
  assert.match(page, /Email Sent the menu mock-up\. .* Call, talked · Online orders Wants a quote by Friday, 40 menu items\. .* Call, left a voicemail with Rita Okafor · Online orders/);
  assert.ok(actions(t.db).includes("touch.logged"));
});

test("a contact from another client is refused", async () => {
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const other = unwrap(crm.createClient(t.services.crm, mikey, { name: "Gormania Feed", sizeTier: "small" }));
  const bob = unwrap(crm.addContact(t.services.crm, mikey, other.id, { name: "Bob Miller", email: "bob@feed.example" }));
  assert.equal(problemOf(await admin.post(`/clients/${clientId}/touches`, { kind: "text", note: "Hi", contactId: bob.id })), "That contact belongs to a different client.");
});
