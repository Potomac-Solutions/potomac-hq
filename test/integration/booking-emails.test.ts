// Emails about booked calls, over real HTTP with a stand-in for Brevo: the
// person who booked hears about every change, the host about the ones they
// did not make, and the day-before reminder goes once.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openTimes, sendBookingReminders } from "../../src/booking/index.ts";
import * as crm from "../../src/crm/index.ts";
import { createServices } from "../../src/services.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, httpClient, PASSWORD, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

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

test("someone new signs up, confirms by email, books, and is a prospect in the CRM", async () => {
  const visitor = httpClient(t.origin);
  assert.match(textOf(await visitor.page("/book")), /To book, make a free account: it takes a minute\. .* Sign up to book I have an account/);
  assert.match(textOf(await visitor.page("/portal/sign-in")), /New here\? Sign up to book a call ?\./);
  const asked = await visitor.post("/portal/sign-up", { name: "Dale Pruitt", business: "Pruitt Farm Stand", email: "Dale@Example.com", phone: "304-555-0134" });
  assert.match(new URL(t.origin + (asked.headers.get("location") ?? "")).searchParams.get("done") ?? "", /^Check your email at dale@example\.com\./);
  const [mail] = to("dale@example.com");
  assert.equal(mail?.subject, "Confirm your email to book a call with Potomac Solutions");
  const link = /https:\/\/hq\.example(\/portal\/accept\?token=[A-Za-z0-9_-]{43}&next=book)/.exec(mail?.body ?? "")?.[1];
  assert.ok(link, "the confirm link, whole");
  // In the CRM already: a prospect, its primary contact and an opportunity.
  const client = t.db.prepare("select id, status from client_organization where name = 'Pruitt Farm Stand'").get();
  assert.equal(client?.["status"], "prospective");
  assert.equal(t.db.prepare("select count(*) as n from opportunity where organization_id = ? and title = 'Signed up to book a call'").get(String(client?.["id"]))?.["n"], 1);
  // The link: choose a password, then straight to booking.
  assert.match(textOf(await visitor.page(link)), /Welcome to your client portal For dale@example\.com ?\./);
  const accepted = await visitor.post("/portal/accept", { token: link.split("token=")[1]?.split("&")[0] ?? "", name: "Dale Pruitt", password: PASSWORD, next: "book" });
  assert.match(accepted.headers.get("location") ?? "", /^\/portal\/book\?done=/);
  sent = [];
  const slot = (await slots())[3];
  await visitor.post("/portal/book", { start: slot?.start ?? "", topic: "Farm stand website" });
  assert.match(to("dale@example.com")[0]?.subject ?? "", /^Your call with Potomac Solutions: /);
  assert.match(to("mikey@example.com")[0]?.subject ?? "", /^Call booked: Dale Pruitt, /);
  assert.ok(actions(t.db).includes("client-user.signed-up"));
});

test("signing up again says the same, and sends only what the inbox's owner can use", async () => {
  sent = [];
  const again = await httpClient(t.origin).post("/portal/sign-up", { name: "Someone Else", email: "dale@example.com" });
  assert.match(new URL(t.origin + (again.headers.get("location") ?? "")).searchParams.get("done") ?? "", /^Check your email at dale@example\.com\./, "nothing says the email is known");
  assert.equal(to("dale@example.com")[0]?.subject, "Your Potomac Solutions client portal");
  assert.match(to("dale@example.com")[0]?.body ?? "", /You already have a client portal account\./);
  assert.equal(t.db.prepare("select count(*) as n from client_organization where name in ('Pruitt Farm Stand', 'Someone Else')").get()?.["n"], 1, "no second client");
  // A bot that fills the hidden field makes nothing.
  sent = [];
  const bot = await httpClient(t.origin).post("/portal/sign-up", { name: "Bot", email: "bot@example.com", website: "http://spam.example" });
  assert.equal(bot.headers.get("location"), "/portal/sign-up");
  assert.equal(sent.length, 0);
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
