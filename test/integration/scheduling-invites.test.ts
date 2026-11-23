// Scheduling invites over real HTTP: Potomac asks a client to pick times;
// the client marks the half hours they could do over Potomac's free time;
// Potomac sees what's free for both, confirms one, and the call is booked.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, clientSignedIn, signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
let rita: Client;
let bob: Client;
let ritaId: string;
let clientId: Id;
const where = (res: Response) => res.headers.get("location") ?? "";
const problemOf = (res: Response) => new URL(t.origin + where(res)).searchParams.get("problem") ?? "";
const monday = (() => {
  const today = Temporal.Now.plainDateISO("America/New_York");
  return today.add({ days: 8 - today.dayOfWeek });
})();
const tuesday = monday.add({ days: 1 });
const inviteId = () => t.db.prepare("select id from schedule_invite order by created_at desc limit 1").get()?.["id"] as string;

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  member = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await admin.get("/");
  await member.get("/");
  // Free weekdays 9:00 to 11:00.
  await admin.post("/calls/hours/week", Object.fromEntries([1, 2, 3, 4, 5].flatMap((d) => [540, 570, 600, 630].map((m) => [`c-${d}-${m}`, "1"]))));
  const me = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  clientId = unwrap(crm.createClient(t.services.crm, me, { name: "Elk Diner", sizeTier: "small" })).id;
  rita = await clientSignedIn(t, admin, clientId, "Rita Okafor", "rita@example.com");
  ritaId = t.db.prepare("select id from client_user where email = 'rita@example.com'").get()?.["id"] as string;
  const other = unwrap(crm.createClient(t.services.crm, me, { name: "Gormania Feed", sizeTier: "small" }));
  bob = await clientSignedIn(t, admin, other.id, "Bob Miller", "bob@feed.example");
});
after(() => t.stop());

test("Potomac asks Rita to pick times; a member can't; bad days are refused", async () => {
  const invite = { clientUserId: ritaId, organizationId: clientId, title: "Kickoff call", minutes: "60", firstDay: monday.toString(), lastDay: tuesday.toString(), note: "About the online orders." };
  assert.equal(problemOf(await admin.post("/invites", { ...invite, lastDay: monday.subtract({ days: 1 }).toString() })), "The last day comes after the first.");
  assert.match(problemOf(await member.post("/invites", invite)), /permission/);
  const made = await admin.post("/invites", invite);
  assert.equal(where(made).split("?")[0], `/calls/invites/${inviteId()}`);
  const page = textOf(await admin.page(`/calls/invites/${inviteId()}`));
  assert.match(page, /Kickoff call Rita Okafor · 60 minutes · Mon, \w+ \d+ to Tue, \w+ \d+ · Waiting for times “About the online orders\.” No time free for both yet Rita Okafor hasn’t picked times yet\./);
  assert.match(textOf(await admin.page("/calls")), /Picking times Kickoff call · Rita Okafor/);
  assert.match(textOf(await admin.page(`/clients/${clientId}`)), /Picking times for a call Kickoff call · Rita Okafor/);
});

test("Rita sees it first in her portal, and marks the times she could do; Bob can't see it", async () => {
  assert.match(textOf(await rita.page("/portal")), /Pick times for a call: Kickoff call 60 minutes, .* Mark every time you could do\. Pick times/);
  const html = await (await rita.get(`/portal/invites/${inviteId()}`)).text();
  assert.match(html, new RegExp(`name="c-${monday}-540" value="1"(?![^>]*disabled)`), "9:00 Monday is open to pick");
  assert.match(html, new RegExp(`name="c-${monday}-480" value="1"[^>]*disabled`), "8:00 isn't");
  assert.equal((await bob.get(`/portal/invites/${inviteId()}`)).status, 404);
  assert.equal(problemOf(await bob.post(`/portal/invites/${inviteId()}`, { [`c-${monday}-540`]: "1" })), "That record doesn’t exist.");
  // Monday 9:30 to 10:30 works for her, and 8:00, which isn't open, is ignored. Tuesday 10:00 only.
  await rita.post(`/portal/invites/${inviteId()}`, { [`c-${monday}-570`]: "1", [`c-${monday}-600`]: "1", [`c-${monday}-480`]: "1", [`c-${tuesday}-600`]: "1" });
  assert.equal(t.db.prepare("select count(*) as n from schedule_invite_cell").get()?.["n"], 3);
  assert.match(textOf(await rita.page("/portal")), /You picked times; Potomac Solutions will confirm one\. Change times/);
  assert.ok(actions(t.db).includes("schedule-invite.answered"));
});

test("Potomac sees the one hour free for both, confirms it, and it's booked", async () => {
  const page = textOf(await admin.page(`/calls/invites/${inviteId()}`));
  assert.match(page, /Free for both: pick one to book it Mon, \w+ \d+, 9:30 AM Your free time and theirs/, "an hour needs two half hours in a row: only Monday 9:30");
  const start = Temporal.PlainDateTime.from(`${monday}T09:30`).toZonedDateTime("America/New_York").toInstant().toString();
  assert.equal(problemOf(await admin.post(`/invites/${inviteId()}/confirm`, { start: Temporal.Instant.from(start).add({ minutes: 30 }).toString() })), "That time isn’t free for both of you any more. Choose another.");
  await admin.post(`/invites/${inviteId()}/confirm`, { start });
  const booked = t.db.prepare("select kind, status, starts_at, ends_at, name, topic, organization_id from booking").get();
  assert.deepEqual({ ...booked }, { kind: "client", status: "booked", starts_at: start, ends_at: Temporal.Instant.from(start).add({ minutes: 60 }).toString(), name: "Rita Okafor", topic: "Kickoff call", organization_id: clientId });
  assert.match(textOf(await rita.page(`/portal/invites/${inviteId()}`)), /It’s booked\./);
  assert.doesNotMatch(textOf(await rita.page("/portal")), /Pick times for a call/);
  assert.equal(problemOf(await rita.post(`/portal/invites/${inviteId()}`, { [`c-${monday}-540`]: "1" })), "That invite was already booked or withdrawn.");
  assert.ok(actions(t.db).includes("schedule-invite.confirmed"));
});

test("a withdrawn invite leaves her portal", async () => {
  await admin.post("/invites", { clientUserId: ritaId, title: "Follow-up", minutes: "30", firstDay: monday.toString(), lastDay: monday.toString() });
  await admin.post(`/invites/${inviteId()}/cancel`, {});
  assert.doesNotMatch(textOf(await rita.page("/portal")), /Follow-up/);
  assert.match(textOf(await rita.page(`/portal/invites/${inviteId()}`)), /withdrew this invite/);
});
