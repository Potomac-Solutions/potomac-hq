// Going cold: an open opportunity with no follow-up and no contact for two
// weeks shows on Today and on its own page; a call or a follow-up warms it.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let quiet: Id;
let fresh: Id;
let planned: Id;
const daysAgo = (days: number) => Temporal.Now.instant().subtract({ hours: 24 * days }).toString();

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await mikey.get("/");
  const me = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const diner = unwrap(crm.createClient(t.services.crm, me, { name: "Elk Diner", sizeTier: "small" })).id;
  const feed = unwrap(crm.createClient(t.services.crm, me, { name: "Gormania Feed", sizeTier: "small" })).id;
  quiet = unwrap(crm.createOpportunity(t.services.crm, me, diner, { title: "Online orders", leadSource: "website" })).id;
  fresh = unwrap(crm.createOpportunity(t.services.crm, me, feed, { title: "New website", leadSource: "referral" })).id;
  planned = unwrap(crm.createOpportunity(t.services.crm, me, feed, { title: "Logo", leadSource: "referral" })).id;
  t.db.prepare("update opportunity set updated_at = ? where id in (?, ?)").run(daysAgo(20), quiet, planned);
  t.db.prepare("update opportunity set follow_up_on = ? where id = ?").run(Temporal.Now.plainDateISO("America/New_York").add({ days: 9 }).toString(), planned);
});
after(() => t.stop());

test("two weeks quiet with no follow-up is going cold, on Today and its own page", async () => {
  const today = textOf(await mikey.page("/today"));
  assert.match(today, /Going cold Online orders Elk Diner · No contact in 20 days and no follow-up set Log a call : Online orders/);
  assert.doesNotMatch(today, /New website|Logo/, "recent, or with a follow-up planned, isn't cold");
  assert.match(textOf(await mikey.page(`/opportunities/${quiet}`)), /Going cold Going cold: no contact in 20 days and no follow-up set\./);
  assert.doesNotMatch(textOf(await mikey.page(`/opportunities/${fresh}`)), /Going cold/);
});

test("a call with the client warms it", async () => {
  await mikey.post(`/opportunities/${quiet}/touches`, { kind: "call", outcome: "voicemail" });
  assert.doesNotMatch(textOf(await mikey.page("/today")), /Going cold/);
});
