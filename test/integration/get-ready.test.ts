// Getting ready for a booked call (decision 0009, slice 5) against a real
// database and over real HTTP: the top bar and Today in the 15 minutes
// before, the Get ready page, starting the call from it, and a booking not
// in the CRM yet.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let shop: Id;
const SOON = "00000000-0000-4000-8000-00000000d001";
const LATER = "00000000-0000-4000-8000-00000000d002";
const STRANGER = "00000000-0000-4000-8000-00000000d003";
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const book = (id: string, startIn: number, length: number, clientId: string | null, name: string, topic: string) =>
  t.db.prepare("insert into booking (id, kind, status, starts_at, ends_at, name, email, phone, topic, crm_client_id, host_id, created_at) values (?, 'public', 'booked', ?, ?, ?, 'someone@example.com', '304-555-0100', ?, ?, ?, ?)").run(id, inMinutes(startIn), inMinutes(startIn + length), name, topic, clientId, mikeyId, new Date().toISOString());
const callIn = (res: Response) => new URL("http://x" + (res.headers.get("location") ?? "")).pathname.split("/")[2] ?? "";

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  shop = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Hensley Body Shop" })).id;
  unwrap(crm.addContact(t.services.crm, mikeyId, shop, { name: "Dale Hensley", phone: "304-555-0100", isPrimary: true }));
});
after(() => t.stop());

test("a call 30 minutes off isn't flagged yet", async () => {
  book(LATER, 30, 30, shop, "Dale Hensley", "Pricing");
  assert.doesNotMatch(textOf(await mikey.page("/clients")), /get ready/);
  t.db.prepare("update booking set status = 'cancelled', cancelled_at = ?, cancelled_by = 'staff' where id = ?").run(new Date().toISOString(), LATER);
});

test("15 minutes before: the top bar and Today say get ready, for the host", async () => {
  book(SOON, 10, 30, shop, "Dale Hensley", "Wants online booking on the site");
  assert.match(textOf(await mikey.page("/clients")), /Call in (9|10) minutes with Dale Hensley \(Hensley Body Shop\): get ready/);
  assert.match(await mikey.page("/clients"), new RegExp(`href="/get-ready/${SOON}"`));
  assert.match(textOf(await mikey.page("/today")), /Call in (9|10) minutes Dale Hensley \(Hensley Body Shop\), at \d{1,2}:\d\d [AP]M\. Get ready/);
  assert.doesNotMatch(textOf(await sam.page("/clients")), /get ready/, "only the host's calls");
  assert.match(textOf(await mikey.page("/calls")), /Get ready ?: what’s worth raising, and the guide\./);
});

test("Get ready: why they booked, the guide, and Start the call", async () => {
  unwrap(crm.logTouch(t.services.touches, mikeyId, { clientId: shop }, { kind: "call", outcome: "reached", note: "Asked about prices." }));
  const page = textOf(await mikey.page(`/get-ready/${SOON}`));
  assert.match(page, /Dale Hensley Hensley Body Shop\. \w+day, \w+ \d+ at \d{1,2}:\d\d [AP]M, in (9|10) minutes\. 30 minutes\./);
  assert.match(page, /They booked it about: Wants online booking on the site/);
  assert.match(page, /Worth raising Last call .*: Asked about prices\./);
  assert.match(page, /The guide: First call A prospect with no proposal yet\. You can switch it on the call\. What does the business do/);
  assert.equal((await sam.get(`/get-ready/${SOON}`)).status, 200, "anyone who can call may read it");
  assert.equal((await mikey.get("/get-ready/00000000-0000-4000-8000-0000000000ff")).status, 404);

  const id = callIn(await mikey.post("/phone", { bookingId: SOON }));
  assert.equal(t.db.prepare("select planned_minutes from call where id = ?").get(id)?.["planned_minutes"], 30);
  assert.match(textOf(await mikey.page("/clients")), /On a call with Hensley Body Shop/);
  assert.doesNotMatch(textOf(await mikey.page("/clients")), /get ready/, "on the call, not getting ready");
  assert.match(textOf(await mikey.page(`/get-ready/${SOON}`)), /Back to the call/);
  await mikey.post(`/phone/${id}/end`, { outcome: "reached", note: "Booked the build." });
  assert.doesNotMatch(textOf(await mikey.page("/clients")), /get ready|On a call/, "called: nothing more to flag");
  assert.doesNotMatch(textOf(await mikey.page(`/get-ready/${SOON}`)), /Start the call/);
});

test("someone not in the CRM yet: add them first", async () => {
  book(STRANGER, 5, 30, null, "June Laurel", "A farm website");
  assert.match(textOf(await mikey.page("/clients")), /Call in [45] minutes with June Laurel: get ready/);
  const page = textOf(await mikey.page(`/get-ready/${STRANGER}`));
  assert.match(page, /They booked from the booking page and aren’t in the CRM yet\. Add them on the Calls page first/);
  assert.doesNotMatch(page, /Worth raising|Start the call/);
  assert.match(page, /The guide: First call/);
});
