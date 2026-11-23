// Emails about booked calls, over real HTTP with a stand-in for Brevo: the
// person who booked hears about every change, the host about the ones they
// did not make, and the day-before reminder goes once.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openTimes, sendBookingReminders } from "../../src/booking/index.ts";
import * as crm from "../../src/crm/index.ts";
import { createServices } from "../../src/services.ts";
import type { Id } from "../../src/shared/index.ts";
import { httpClient, PASSWORD, signIn, TEST_PASSWORD_COST, testApp, unwrap, type Client, type TestApp } from "../support/harness.ts";

type Sent = { to: string; subject: string; body: string };
let sent: Sent[] = [];
let t: TestApp;
let admin: Client;
let ann: Client;
const allWeek = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].flatMap((day) => [[`start-${day}-0`, "00:00"], [`end-${day}-0`, "23:00"]]));
const slots = async () => (await openTimes(t.services.booking, "public")).days.flatMap((day) => day.slots);
const to = (email: string) => sent.filter((one) => one.to === email);

before(async () => {
  t = await testApp({
    passwordCost: TEST_PASSWORD_COST,
    publicUrl: "https://hq.example",
    contact: { phone: "304-555-0142", email: "", address: "" },
    email: { publicUrl: "https://hq.example", send: async (message) => (sent.push({ to: message.to, subject: message.subject, body: message.body }), { ok: true }) },
  });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const bakery = unwrap(crm.createClient(t.services.crm, mikey, { name: "Mt. Storm Bakery", sizeTier: "small" }));
  // With email on, the invite is emailed rather than shown.
  await admin.post(`/clients/${bakery.id}/portal-users`, { name: "Ann Baker", email: "ann@bakery.example" });
  const token = /\/portal\/accept\?token=([A-Za-z0-9_-]{43})/.exec(sent.map((one) => one.body).join("\n"))?.[1] ?? "";
  assert.ok(token);
  ann = httpClient(t.origin);
  assert.equal((await ann.post("/portal/accept", { token, name: "Ann Baker", password: PASSWORD })).status, 303);
  await admin.post("/calls/hours", { ...allWeek, "call-minutes": "60", "gap-minutes": "0", "notice-hours": "1", "days-ahead": "14", "portal-open": "1", "public-open": "1" });
  sent = [];
});
after(() => t.stop());

test("booking from the page: the person gets their private link, and the host is told", async () => {
  const visitor = httpClient(t.origin);
  assert.match(await visitor.page("/book"), /Your booking and a link to change it are sent here/);
  const slot = (await slots())[3];
  const made = await visitor.post("/book", { name: "Dale Pruitt", email: "dale@example.com", topic: "Farm stand website", start: slot?.start ?? "" });
  const link = (made.headers.get("location") ?? "").replace(/&done=.*$/, "");
  const [mine] = to("dale@example.com");
  assert.ok(mine);
  assert.match(mine.subject, /^Your call with Potomac Solutions: /);
  assert.ok(mine.body.includes(`https://hq.example${link}`), "the private link, whole");
  assert.match(mine.body, /Need us sooner\? Call 304-555-0142\./);
  const [host] = to("mikey@example.com");
  assert.match(host?.subject ?? "", /^Call booked: Dale Pruitt, /);
  assert.match(host?.body ?? "", /All calls: https:\/\/hq\.example\/calls/);
  assert.match(await visitor.page(link), /It was also emailed to you\./);

  // Moving and cancelling it with the link: both hear each time.
  sent = [];
  const token = link.split("token=")[1] as string;
  await visitor.post("/book/manage/move", { token, start: (await slots()).at(-1)?.start ?? "" });
  assert.match(to("dale@example.com")[0]?.subject ?? "", /^Your call is moved: /);
  assert.match(to("mikey@example.com")[0]?.body ?? "", /moved their call from /);
  sent = [];
  await visitor.post("/book/manage/cancel", { token, reason: "Hired someone local" });
  assert.match(to("dale@example.com")[0]?.body ?? "", /is cancelled, as you asked\..*Book another time here:\nhttps:\/\/hq\.example\/book/s);
  assert.match(to("mikey@example.com")[0]?.body ?? "", /Why: Hired someone local/);
});

test("a client's booking points them to the portal; a cancel by Potomac tells only the client", async () => {
  sent = [];
  await ann.post("/portal/book", { start: (await slots())[5]?.start ?? "", topic: "Menu page" });
  assert.match(to("ann@bakery.example")[0]?.body ?? "", /here:\nhttps:\/\/hq\.example\/portal#calls/);
  assert.match(to("mikey@example.com")[0]?.subject ?? "", /^Call booked: Ann Baker, /);
  const id = t.db.prepare("select id from booking where kind = 'client'").get()?.["id"] as string;
  sent = [];
  await admin.post(`/calls/${id}/cancel`, { reason: "Snowed in" });
  assert.equal(sent.length, 1, "the host made the change, so only the client hears");
  assert.match(sent[0]?.body ?? "", /Potomac Solutions had to cancel your call on .*\.\n\n"Snowed in"/);
});

test("the day-before reminder goes once, only for calls booked well ahead", async () => {
  // Booked now, for at least two days out.
  const later = (await slots()).find((slot) => Temporal.Instant.from(slot.start).since(Temporal.Now.instant()).total("hours") > 50);
  assert.ok(later);
  await ann.post("/portal/book", { start: later.start, topic: "Holiday hours" });
  const dayBefore = Temporal.Instant.from(later.start).subtract({ hours: 12 }).toString();
  const deps = createServices(t.db, { clock: () => dayBefore }).booking;
  const mail = async (message: Sent) => (sent.push(message), true);
  sent = [];
  assert.deepEqual(await sendBookingReminders(deps, mail, { publicUrl: "https://hq.example", phone: "" }), { sent: 1, failed: 0 });
  assert.match(sent[0]?.subject ?? "", /^Tomorrow: your call with Potomac Solutions, /);
  assert.equal(sent[0]?.to, "ann@bakery.example");
  assert.deepEqual(await sendBookingReminders(deps, mail, { publicUrl: "https://hq.example", phone: "" }), { sent: 0, failed: 0 }, "never twice");
});
