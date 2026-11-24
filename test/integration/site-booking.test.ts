// Booking from Potomac's website over real HTTP, as the website's server
// calls it with its token: someone new gets a call, an account and a link to
// their dashboard in one step; anyone already on file, by email or phone,
// gets a sign-in link at the email on file and no second call.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import { issueSiteToken } from "../../src/public-site/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, httpClient, PASSWORD, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

type Sent = { to: string; subject: string; body: string };
let sent: Sent[] = [];
let t: TestApp;
let admin: Client;
let token = "";
const allWeek = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].flatMap((day) => [[`start-${day}-0`, "00:00"], [`end-${day}-0`, "23:00"]]));
type Times = { ok: boolean; open: boolean; days: { day: string; label: string; slots: { start: string; label: string }[] }[] };
const times = async (): Promise<Times> => (await (await fetch(`${t.origin}/api/site/booking`, { headers: { authorization: `Bearer ${token}` } })).json()) as Times;
let visitors = 0;
const book = (body: Record<string, string>, bearer = token) => fetch(`${t.origin}/api/site/booking`, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify({ visitor: `203.0.113.${(visitors += 1)}`, ...body }) });
const count = (sql: string) => Number(t.db.prepare(sql).get()?.["n"] ?? 0);
const linkIn = (body: string) => /https:\/\/hq\.example(\/portal\/accept\?token=[A-Za-z0-9_-]{43}[^\s]*)/.exec(body)?.[1] ?? "";

before(async () => {
  t = await testApp({
    passwordCost: TEST_PASSWORD_COST,
    publicUrl: "https://hq.example",
    contact: { phone: "304-555-0142", email: "", address: "" },
    email: { publicUrl: "https://hq.example", send: async (message) => (sent.push({ to: message.to, subject: message.subject, body: message.body }), { ok: true }) },
  });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  await admin.post("/calls/hours", { ...allWeek, "call-minutes": "60", "gap-minutes": "0", "notice-hours": "1", "days-ahead": "14", "portal-open": "1", "public-open": "1" });
  token = issueSiteToken(t.services.publicSite);
  sent = [];
});
after(() => t.stop());

test("only the website's token can read times or book", async () => {
  assert.equal((await fetch(`${t.origin}/api/site/booking`)).status, 401);
  assert.equal((await book({ name: "X" }, "wrong")).status, 401);
  const open = await times();
  assert.equal(open.open, true);
  assert.ok(open.days[0]?.slots[0]?.start);
});

test("someone new books from the website: a call, an account, and a link to their dashboard", async () => {
  const slot = (await times()).days[0]?.slots[1];
  assert.ok(slot);
  const res = await book({ name: "Dale Pruitt", email: "Dale.Pruitt@gmail.com", phone: "(304) 555-0134", business: "Pruitt Farm Stand", topic: "A website for the farm stand", start: slot.start });
  const answer = (await res.json()) as { status: string; when: string; sent: boolean };
  assert.equal(answer.status, "booked");
  assert.equal(answer.sent, true);
  assert.equal(count("select count(*) as n from client_user where email = 'dale.pruitt@gmail.com'"), 1);
  assert.equal(count("select count(*) as n from booking where email = 'dale.pruitt@gmail.com' and status = 'booked' and organization_id is not null"), 1);
  const welcome = sent.find((one) => one.to === "dale.pruitt@gmail.com" && one.subject === "Your call with Potomac Solutions is booked");
  assert.ok(welcome, "the dashboard link is emailed");
  assert.match(welcome.body, new RegExp(answer.when.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const link = linkIn(welcome.body);
  assert.ok(link && !link.includes("next=book"), "the link opens the dashboard, not the booking page");
  assert.ok(sent.some((one) => one.to === "mikey@example.com"), "the host hears about it");
  assert.ok(actions(t.db).includes("client-user.signed-up") && actions(t.db).includes("booking.made"));

  // The link sets a password and opens their dashboard, with the call on it.
  const dale = httpClient(t.origin);
  const tokenOf = /token=([A-Za-z0-9_-]{43})/.exec(link)?.[1] ?? "";
  assert.equal((await dale.post("/portal/accept", { token: tokenOf, name: "Dale Pruitt", password: PASSWORD })).headers.get("location")?.startsWith("/portal?") ?? false, true);
  assert.match(textOf(await dale.page("/portal")), /Dale|call/i);
  sent = [];
});

test("the same person again, by an email alias or the same phone, is not booked twice", async () => {
  const slot = (await times()).days[1]?.slots[0];
  assert.ok(slot);
  const before = { users: count("select count(*) as n from client_user"), calls: count("select count(*) as n from booking") };
  for (const [email, phone] of [
    ["dalepruitt+again@gmail.com", "304-555-9999"],
    ["someone.else@example.com", "+1 304.555.0134"],
  ] as const) {
    sent = [];
    const answer = (await (await book({ name: "Dale Again", email, phone, start: slot.start })).json()) as { status: string; sent: boolean };
    assert.equal(answer.status, "known");
    assert.equal(answer.sent, true);
    assert.deepEqual(sent.map((one) => one.to), ["dale.pruitt@gmail.com"], "the link goes to the email on file, never the one typed");
    assert.equal(sent[0]?.subject, "Your Potomac Solutions client portal");
  }
  assert.equal(count("select count(*) as n from client_user"), before.users);
  assert.equal(count("select count(*) as n from booking"), before.calls);

  // The portal's own sign-up follows the same rule.
  sent = [];
  await httpClient(t.origin).post("/portal/sign-up", { name: "Dale Third", email: "third@example.com", phone: "304 555 0134" });
  assert.deepEqual(sent.map((one) => one.to), ["dale.pruitt@gmail.com"]);
  assert.equal(count("select count(*) as n from client_user where email = 'third@example.com'"), 0);
});

test("a CRM contact's phone finds them; a demo client's never blocks anyone", async () => {
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const bakery = unwrap(crm.createClient(t.services.crm, mikey, { name: "Mt. Storm Bakery", sizeTier: "small" }));
  unwrap(crm.addContact(t.services.crm, mikey, bakery.id, { name: "Ann Baker", email: "ann@bakery.example", phone: "304-555-0177", isPrimary: true }));
  const demo = unwrap(crm.createClient(t.services.crm, mikey, { name: "Demo Diner", sizeTier: "small" }));
  unwrap(crm.addContact(t.services.crm, mikey, demo.id, { name: "Demo", phone: "304-555-0188" }));
  t.db.prepare("update client_organization set demo = 1 where id = ?").run(demo.id);
  const slot = (await times()).days[2]?.slots[0];
  assert.ok(slot);

  sent = [];
  const ann = (await (await book({ name: "Ann", email: "ann.other@example.com", phone: "3045550177", start: slot.start })).json()) as { status: string };
  assert.equal(ann.status, "known");
  assert.deepEqual(sent.map((one) => one.to), ["ann@bakery.example"]);

  const fresh = (await (await book({ name: "Rae", email: "rae@example.com", phone: "304-555-0188", start: slot.start })).json()) as { status: string };
  assert.equal(fresh.status, "booked");
});

test("a bad form or a taken time is refused, and nothing is made", async () => {
  const users = count("select count(*) as n from client_user");
  const slot = (await times()).days[3]?.slots[0];
  assert.ok(slot);
  const refused = async (body: Record<string, string>) => (await (await book(body)).json()) as { error: string; message: string };
  assert.equal((await refused({ name: "Lee", email: "lee@example.com", phone: "555-0100", start: slot.start })).error, "phone-invalid");
  assert.equal((await refused({ name: "Lee", email: "nope", phone: "304-555-0101", start: slot.start })).error, "email-invalid");
  assert.equal((await refused({ name: "", email: "lee@example.com", phone: "304-555-0101", start: slot.start })).error, "name-missing");
  assert.equal((await refused({ name: "Lee", email: "lee@example.com", phone: "304-555-0101", start: "" })).error, "time-missing");
  const taken = await book({ name: "Lee", email: "lee.two@example.com", phone: "304-555-0101", start: "2001-01-01T14:00:00Z" });
  assert.equal(taken.status, 409);
  assert.equal(count("select count(*) as n from client_user"), users);
});

test("one visitor can't book over and over", async () => {
  const slot = (await times()).days[4]?.slots[0];
  assert.ok(slot);
  const codes: string[] = [];
  for (let n = 0; n < 6; n += 1) {
    const res = await book({ visitor: "198.51.100.7", name: "Spam", email: `spam${n}@example.com`, phone: "304-555-01", start: slot.start });
    codes.push(((await res.json()) as { error?: string }).error ?? "");
  }
  assert.equal(codes.at(-1), "too-many");
});
