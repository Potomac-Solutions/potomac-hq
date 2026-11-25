// Following through from the call screen (decision 0009, slice 3), against a
// real database and over real HTTP: booking the next call while they're on
// the line, next steps as to-dos, and the call's time on the project.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let mikeyId: Id;
const allWeek = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].flatMap((day) => [[`start-${day}-0`, "00:00"], [`end-${day}-0`, "23:00"]]));
const query = (res: Response, name: string) => new URL("http://x" + (res.headers.get("location") ?? "")).searchParams.get(name) ?? "";
const callIn = (res: Response) => new URL("http://x" + (res.headers.get("location") ?? "")).pathname.split("/")[2] ?? "";

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await mikey.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
});
after(() => t.stop());

test("with no hours set, the wrap-up says where to set them", async () => {
  const shop = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Hensley Body Shop" }));
  unwrap(crm.addContact(t.services.crm, mikeyId, shop.id, { name: "Dale Hensley", email: "dale@example.com", phone: "304-555-0100", isPrimary: true }));
  const id = callIn(await mikey.post("/phone", { clientId: shop.id }));
  assert.match(textOf(await mikey.page(`/phone/${id}`)), /No open times to offer here\. Set your hours under Calls → Hours/);
  assert.match(query(await mikey.post(`/phone/${id}/book`, { start: "2027-01-05T15:00:00Z" }), "problem"), /Paint your usual week first/);
  await mikey.post(`/phone/${id}/end`, { outcome: "no-answer" });
});

test("book the next call while they're on the line, at the CRM client, with its own link", async () => {
  await mikey.post("/calls/hours", { ...allWeek, "call-minutes": "30", "gap-minutes": "0", "notice-hours": "1", "days-ahead": "14" });
  const { client, opportunity } = await wonProject(t.services, mikeyId, { client: "Elk Diner", title: "Diner website" });
  const rita = unwrap(crm.addContact(t.services.crm, mikeyId, client.id, { name: "Rita Okafor", email: "rita@example.com", phone: "304-555-0111", isPrimary: true }));
  const id = callIn(await mikey.post("/phone", { contactId: rita.id }));
  const html = await mikey.page(`/phone/${id}`);
  assert.match(textOf(html), /Book another call \(30 min\)/, "booking isn't open to the public, but Potomac can book its own calendar");
  const offered = [...html.matchAll(/name="start" value="([^"]+)"/g)].map((m) => m[1] ?? "");
  assert.equal(offered.length, 6, "the next six open times");

  assert.match(query(await mikey.post(`/phone/${id}/book`, {}), "problem"), /Choose a time/);
  assert.match(query(await mikey.post(`/phone/${id}/book`, { start: "2020-01-01T15:00:00Z" }), "problem"), /just taken/);
  const booked = await mikey.post(`/phone/${id}/book`, { start: offered[0] ?? "" });
  assert.match(query(booked, "done"), /^Booked: \w+day, \w+ \d+ at \d{1,2}:\d\d [AP]M\. Email is off, so tell them the time\.$/);
  assert.equal(new URL("http://x" + (booked.headers.get("location") ?? "")).hash, "#wrap-up");
  const row = t.db.prepare("select kind, status, name, email, phone, crm_client_id, crm_opportunity_id, business, manage_hash from booking where starts_at = ?").get(offered[0] ?? "") as Record<string, unknown>;
  assert.deepEqual([row["kind"], row["status"], row["name"], row["email"], row["crm_client_id"], row["business"]], ["public", "booked", "Rita Okafor", "rita@example.com", client.id, "Elk Diner"]);
  assert.ok(row["manage_hash"], "a link to move or cancel it");
  assert.equal(row["crm_opportunity_id"], null, "a call from a contact isn't on an opportunity");
  assert.ok(t.db.prepare("select 1 from activity_event where action = 'booking.made' and context like ?").get(`%"callId":"${id}"%`));
  // The time is gone from what's offered, and shows on the Calls page as startable.
  assert.doesNotMatch(await mikey.page(`/phone/${id}`), new RegExp(`value="${offered[0]}"`));
  assert.match(textOf(await mikey.page("/calls")), /Rita Okafor .* Start the call/);
  void opportunity;

  // Ending: next steps become to-dos at the client, and the time goes to the project.
  t.db.prepare("update call set started_at = ? where id = ?").run(new Date(Date.now() - 20 * 60_000).toISOString(), id);
  const page = textOf(await mikey.page(`/phone/${id}`));
  assert.match(page, /Next steps for you .* Log this call’s time Don’t log it To Diner website/);
  const ended = await mikey.post(`/phone/${id}/end`, { outcome: "reached", note: "Menu first.", nextSteps: "Send the menu mock-up\n\n- Ask for photos\n", logTo: String(t.db.prepare("select id from project where name = 'Diner website'").get()?.["id"]) });
  assert.match(query(ended, "done"), /^Call ended and logged\. 2 to-dos added\. 2[01] min logged to the project\.$/);
  const todos = t.db.prepare("select title, organization_id from task where project_id is null order by rowid").all();
  assert.deepEqual(todos.map((one) => [one["title"], one["organization_id"]]), [["Send the menu mock-up", client.id], ["Ask for photos", client.id]]);
  const entry = t.db.prepare("select minutes, note, billable from time_entry order by rowid desc limit 1").get() as Record<string, unknown>;
  assert.ok([20, 21].includes(Number(entry["minutes"])));
  assert.deepEqual([entry["note"], entry["billable"]], ["Call with Elk Diner", 0], "a fixed-price project's time isn't billable");
});

test("a project billed by the hour is ticked to start with, and the time is billable", async () => {
  const { client } = await wonProject(t.services, mikeyId, { client: "Gormania Feed", title: "Feed store", pricing: "hourly", amount: "75" });
  unwrap(crm.addContact(t.services.crm, mikeyId, client.id, { name: "Gus Gormania", email: "gus@example.com", isPrimary: true }));
  const id = callIn(await mikey.post("/phone", { clientId: client.id }));
  const html = await mikey.page(`/phone/${id}`);
  assert.match(html, /name="logTo" value="[0-9a-f-]{36}" checked/);
  assert.match(textOf(html), /To Feed store ?, billed by the hour/);
  const projectId = /name="logTo" value="([0-9a-f-]{36})" checked/.exec(html)?.[1] ?? "";
  assert.match(query(await mikey.post(`/phone/${id}/end`, { outcome: "reached", note: "Quick check-in.", logTo: projectId }), "done"), /1 min logged to the project\./);
  assert.equal(t.db.prepare("select billable from time_entry where project_id = ?").get(projectId)?.["billable"], 1);
  // Follow-through only after the call is ended, and only by the person on it.
  assert.deepEqual(crm.followThroughCall(t.services.calls, mikeyId, id as Id, { nextSteps: "x" }).ok, true);
  const other = callIn(await mikey.post("/phone", { clientId: client.id }));
  assert.deepEqual(crm.followThroughCall(t.services.calls, mikeyId, other as Id, { nextSteps: "x" }), { ok: false, error: "call-open" });
  await mikey.post(`/phone/${other}/end`, { outcome: "no-answer" });
});

test("a contact with no email can't be booked, and says why", async () => {
  const farm = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Laurel Run Farm" }));
  unwrap(crm.addContact(t.services.crm, mikeyId, farm.id, { name: "June Laurel", phone: "304-555-0123", isPrimary: true }));
  const id = callIn(await mikey.post("/phone", { clientId: farm.id }));
  const start = /name="start" value="([^"]+)"/.exec(await mikey.page(`/phone/${id}`))?.[1] ?? "";
  assert.match(query(await mikey.post(`/phone/${id}/book`, { start }), "problem"), /has no email in HQ/);
  await mikey.post(`/phone/${id}/end`, { outcome: "no-answer" });
  assert.match(query(await mikey.post(`/phone/${id}/book`, { start }), "problem"), /That call has ended/);
});
