// The call screen (decision 0009, slice 1) against a real database and over
// real HTTP: start a call from a client, a contact, an opportunity or a
// booked call; one open call per person; the timer's phases; changing the
// length; notes kept as typed; ending it into the call log with its length;
// and a call nobody ended closed after 3 hours.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let shopId: Id;
let daleId: Id;
let dealId: Id;
const query = (res: Response, name: string) => new URL("http://x" + (res.headers.get("location") ?? "")).searchParams.get(name) ?? "";
const path = (res: Response) => new URL("http://x" + (res.headers.get("location") ?? "")).pathname;
const callRow = (id: string) => t.db.prepare("select * from call where id = ?").get(id) as Record<string, unknown>;
const backdate = (id: string, minutes: number) => t.db.prepare("update call set started_at = ? where id = ?").run(new Date(Date.now() - minutes * 60_000).toISOString(), id);

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const shop = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Hensley Body Shop", phone: "(304) 555-0199" }));
  shopId = shop.id;
  daleId = unwrap(crm.addContact(t.services.crm, mikeyId, shopId, { name: "Dale Hensley", phone: "304-555-0100", isPrimary: true })).id;
  dealId = unwrap(crm.createOpportunity(t.services.crm, mikeyId, shopId, { title: "New website", leadSource: "referral", contactId: daleId })).id;
});
after(() => t.stop());

test("a phone number becomes a tel: address", () => {
  assert.equal(crm.dialAddress("304-555-0100"), "tel:+13045550100");
  assert.equal(crm.dialAddress("(304) 555-0199"), "tel:+13045550199");
  assert.equal(crm.dialAddress("1 304 555 0100"), "tel:+13045550100");
  assert.equal(crm.dialAddress("+44 20 7946 0958"), "tel:+442079460958");
  assert.equal(crm.dialAddress("call me"), "");
});

test("start a call from a client: the screen dials, times and plans 15 minutes", async () => {
  assert.match(textOf(await mikey.page(`/clients/${shopId}`)), /Start a call A timer, notes, and a nudge to wrap up/);
  const started = await mikey.post("/phone", { clientId: shopId });
  assert.equal(started.status, 303);
  assert.equal(query(started, "done"), "The timer's running.");
  const id = path(started).split("/")[2] ?? "";
  const row = callRow(id);
  assert.deepEqual([row["contact_id"], row["phone"], row["planned_minutes"], row["warn_minutes"]], [daleId, "304-555-0100", 15, 5], "the primary contact, and their number");
  const html = await mikey.page(`/phone/${id}`);
  assert.match(html, /href="tel:\+13045550100"/);
  assert.match(textOf(html), /Dale Hensley Hensley Body Shop .*Dial 304-555-0100 .*0:0\d On the call Planned for 15 min\. Wrap up at \d{1,2}:\d\d [AP]M, done by \d{1,2}:\d\d [AP]M\./);
  assert.match(textOf(await mikey.page("/clients")), /On a call with Hensley Body Shop/, "the top bar leads back to it");
  assert.doesNotMatch(textOf(html), /On a call with/, "but not on the call screen itself");

  // One open call per person: starting another goes back to this one.
  const again = await mikey.post("/phone", { opportunityId: dealId });
  assert.equal(path(again), `/phone/${id}`);
  assert.equal(query(again, "done"), "You're still on this call. End it before starting another.");
  // Nobody else sees it.
  assert.equal((await sam.get(`/phone/${id}`)).status, 404);
  assert.equal(query(await sam.post(`/phone/${id}/end`, { outcome: "reached", note: "x" }), "problem"), "That record doesn’t exist.");

  // Shorter and longer, 5 minutes at a time, the warning moving with it.
  assert.equal(query(await mikey.post(`/phone/${id}/shorter`, {}), "done"), "Planned for 10 minutes.");
  assert.deepEqual([callRow(id)["planned_minutes"], callRow(id)["warn_minutes"]], [10, 3]);
  await mikey.post(`/phone/${id}/shorter`, {});
  assert.match(query(await mikey.post(`/phone/${id}/shorter`, {}), "problem"), /5 minutes to 4 hours/);
  await mikey.post(`/phone/${id}/longer`, {});
  await mikey.post(`/phone/${id}/longer`, {});
  assert.equal(callRow(id)["planned_minutes"], 15);

  // The phases, as the page is made: wrap-up 5 minutes before the end, then over.
  backdate(id, 11);
  assert.match(textOf(await mikey.page(`/phone/${id}`)), /11:0\d Start wrapping up/);
  backdate(id, 17);
  assert.match(textOf(await mikey.page(`/phone/${id}`)), /17:0\d Over the planned time/);

  // Notes are kept as they're typed, then ending logs the call with its length.
  assert.equal(query(await mikey.post(`/phone/${id}/note`, { note: "Wants online booking." }), "done"), "Notes saved.");
  assert.match(await mikey.page(`/phone/${id}`), /Wants online booking\./);
  const ended = await mikey.post(`/phone/${id}/end`, { outcome: "reached", note: "Wants online booking. Sending a quote Friday." });
  assert.equal(path(ended), `/clients/${shopId}`);
  assert.equal(query(ended, "done"), "Call ended and logged.");
  const touch = t.db.prepare("select * from touch where call_id = ?").get(id) as Record<string, unknown>;
  assert.deepEqual([touch["kind"], touch["outcome"], touch["contact_id"], touch["note"]], ["call", "reached", daleId, "Wants online booking. Sending a quote Friday."]);
  assert.ok([17, 18].includes(Number(touch["minutes"])), "whole minutes, rounded up");
  assert.equal(callRow(id)["touch_id"], touch["id"]);
  assert.match(textOf(await mikey.page(`/clients/${shopId}`)), /Call, talked, 1[78] min/);
  assert.doesNotMatch(textOf(await mikey.page("/clients")), /On a call with/);
  assert.match(textOf(await mikey.page(`/phone/${id}`)), /This call ended .*It’s in the call log\./);
  assert.match(query(await mikey.post(`/phone/${id}/note`, { note: "late" }), "problem"), /That call has ended/);
  const kinds = t.db.prepare("select action from activity_event where record_id = ? order by rowid").all(id).map((row) => row["action"]);
  assert.deepEqual(kinds, ["call.started", "call.length-changed", "call.length-changed", "call.length-changed", "call.length-changed", "call.ended"]);
});

test("from an opportunity it's logged there, with a follow-up; a voicemail needs no note", async () => {
  const started = await mikey.post("/phone", { opportunityId: dealId });
  const id = path(started).split("/")[2] ?? "";
  assert.match(textOf(await mikey.page(`/phone/${id}`)), /Dale Hensley Hensley Body Shop ?, about New website/);
  const ended = await mikey.post(`/phone/${id}/end`, { outcome: "voicemail", note: "", followUpOn: "2027-01-08" });
  assert.equal(path(ended), `/opportunities/${dealId}`);
  const touch = t.db.prepare("select * from touch where call_id = ?").get(id) as Record<string, unknown>;
  assert.deepEqual([touch["opportunity_id"], touch["outcome"], touch["minutes"]], [dealId, "voicemail", 1]);
  assert.equal(t.db.prepare("select follow_up_on from opportunity where id = ?").get(dealId)?.["follow_up_on"], "2027-01-08");
});

test("a talk needs a word about it, and the form keeps the outcome", async () => {
  const id = path(await mikey.post("/phone", { contactId: daleId })).split("/")[2] ?? "";
  const refused = await mikey.post(`/phone/${id}/end`, { outcome: "reached", note: "" });
  assert.equal(path(refused), `/phone/${id}`);
  assert.match(query(refused, "problem"), /Add a word about it/);
  assert.equal(callRow(id)["ended_at"], null, "still on the call");
  await mikey.post(`/phone/${id}/end`, { outcome: "no-answer" });
});

test("a booked call plans its own length, and needs to be in the CRM", async () => {
  const insert = (id: string, organizationId: string | null, minutes: number, status = "booked") =>
    // From the booking page: once added to the CRM, its client is in crm_client_id.
    t.db.prepare("insert into booking (id, kind, status, starts_at, ends_at, name, email, phone, topic, crm_client_id, host_id, created_at) values (?, 'public', ?, ?, ?, 'Dale Hensley', 'dale@example.com', '304-555-0177', 'Online booking', ?, ?, ?)")
      .run(id, status, "2026-12-01T15:00:00.000Z", new Date(Date.parse("2026-12-01T15:00:00.000Z") + minutes * 60_000).toISOString(), organizationId, mikeyId, new Date().toISOString());
  insert("00000000-0000-4000-8000-000000000b01", shopId, 30);
  insert("00000000-0000-4000-8000-000000000b02", null, 30);
  insert("00000000-0000-4000-8000-000000000b03", shopId, 30, "cancelled");
  assert.match(query(await mikey.post("/phone", { bookingId: "00000000-0000-4000-8000-000000000b02", back: "/calls" }), "problem"), /Add this booking to the CRM first/);
  assert.match(query(await mikey.post("/phone", { bookingId: "00000000-0000-4000-8000-000000000b03", back: "/calls" }), "problem"), /was cancelled/);
  assert.equal(path(await mikey.post("/phone", { bookingId: "00000000-0000-4000-8000-000000000b03", back: "//evil.example" })), "/today", "back only to HQ");
  const id = path(await mikey.post("/phone", { bookingId: "00000000-0000-4000-8000-000000000b01" })).split("/")[2] ?? "";
  assert.deepEqual([callRow(id)["planned_minutes"], callRow(id)["warn_minutes"], callRow(id)["booking_id"]], [30, 5, "00000000-0000-4000-8000-000000000b01"]);
  assert.match(textOf(await mikey.page(`/phone/${id}`)), /They booked it about: Online booking/);
  await mikey.post(`/phone/${id}/end`, { outcome: "no-answer" });
});

test("a call nobody ended is closed after 3 hours and logged as a guess", async () => {
  const id = path(await mikey.post("/phone", { clientId: shopId })).split("/")[2] ?? "";
  backdate(id, 200);
  assert.equal(crm.endForgottenCalls(t.services.calls), 1);
  const touch = t.db.prepare("select * from touch where call_id = ?").get(id) as Record<string, unknown>;
  assert.equal(touch["minutes"], 180);
  assert.match(String(touch["note"]), /Ended by HQ after 3 hours, because nobody ended it\. The length is a guess\./);
  assert.ok(t.db.prepare("select 1 from activity_event where action = 'call.ended-automatically' and record_id = ?").get(id));
  assert.equal(crm.endForgottenCalls(t.services.calls), 0);
});
