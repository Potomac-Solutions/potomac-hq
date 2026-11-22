// Booking in the portal, over real HTTP: a client books, moves and cancels
// their own calls, and can reach no other client's.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openTimes } from "../../src/booking/index.ts";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, clientSignedIn, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let ann: Client;
let bob: Client;
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const allWeek = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].flatMap((day) => [[`start-${day}-0`, "00:00"], [`end-${day}-0`, "23:00"]]));
const hours = (portal: boolean) => ({ ...allWeek, "call-minutes": "60", "gap-minutes": "0", "notice-hours": "1", "days-ahead": "14", ...(portal ? { "portal-open": "1" } : {}) });
const slots = async () => (await openTimes(t.services.booking, "portal")).days.flatMap((day) => day.slots);
const callIds = () => t.db.prepare("select id, organization_id from booking order by created_at").all() as { id: Id; organization_id: Id }[];

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const bakery = unwrap(crm.createClient(t.services.crm, mikey, { name: "Mt. Storm Bakery", sizeTier: "small" }));
  const feed = unwrap(crm.createClient(t.services.crm, mikey, { name: "Gormania Feed", sizeTier: "small" }));
  ann = await clientSignedIn(t, admin, bakery.id, "Ann Baker", "ann@bakery.example");
  bob = await clientSignedIn(t, admin, feed.id, "Bob Miller", "bob@feed.example");
});
after(() => t.stop());

test("with portal booking off, clients ask for a call as before", async () => {
  await admin.post("/calls/hours", hours(false));
  const home = textOf(await ann.page("/portal"));
  assert.match(home, /Ask for a call When is a good time to call you\?/);
  assert.doesNotMatch(home, /Book a call/);
  assert.match(textOf(await ann.page("/portal/book")), /Booking a time isn’t available right now\./);
  assert.equal(problemOf(await ann.post("/portal/book", { start: "2099-01-01T14:00:00Z" })), "Booking a time is off right now. Ask for a call instead.");
});

test("a client books an open time, with what it is about, and sees it on their home", async () => {
  await admin.post("/calls/hours", hours(true));
  assert.match(textOf(await ann.page("/portal")), /Calls Book a call Or ask for a call/);
  const book = await ann.page("/portal/book");
  assert.match(textOf(book), /Book a call .* Each call is 60 minutes\. Times are Eastern\./);
  const slot = (await slots())[3];
  assert.ok(slot);
  assert.ok(book.includes(`value="${slot.start}"`), "each time is a button");

  const made = await ann.post("/portal/book", { start: slot.start, topic: "The holiday menu page", phone: "304-555-0101" });
  assert.equal(doneOf(made), "Your call is booked. It’s below, with a file to add it to your calendar.");
  const home = textOf(await ann.page("/portal"));
  assert.match(home, /The holiday menu page Add to your calendar · Move it Cancel this call/);
  assert.equal(problemOf(await bob.post("/portal/book", { start: slot.start })), "That time was just taken. Choose another.", "Bob can't have it too");

  // HQ sees who it is, from the client's own account.
  assert.match(textOf(await admin.page("/calls")), /Ann Baker Client ann@bakery\.example · 304-555-0101/);
  assert.ok(actions(t.db).includes("booking.made"));
});

test("a client moves and cancels their own call, and downloads its calendar file", async () => {
  const [mine] = callIds();
  assert.ok(mine);
  const file = await ann.get(`/portal/calls/${mine.id}.ics`);
  assert.equal(file.status, 200);
  assert.match(await file.text(), /SUMMARY:Call with Potomac Solutions\r\n/);

  assert.match(textOf(await ann.page(`/portal/book?move=${mine.id}`)), /Move your call Back to your portal Your call is now .*\. Choose a new time\./);
  const to = (await slots()).at(-1);
  assert.ok(to);
  assert.equal(doneOf(await ann.post(`/portal/calls/${mine.id}/move`, { start: to.start })), "Your call is moved. Add it to your calendar again to update it there.");
  assert.equal(t.db.prepare("select starts_at from booking where id = ?").get(mine.id)?.["starts_at"], to.start);

  assert.equal(doneOf(await ann.post(`/portal/calls/${mine.id}/cancel`, { reason: "Oven repair" })), "Your call is cancelled. Book another time whenever suits you.");
  assert.match(textOf(await ann.page("/portal")), /: cancelled .* Cancelled by Ann Baker: Oven repair/);
});

test("a client can reach no other client's call", async () => {
  const slot = (await slots())[5];
  assert.ok(slot);
  await bob.post("/portal/book", { start: slot.start, topic: "Feed store hours" });
  const bobs = callIds().at(-1);
  assert.ok(bobs);
  assert.equal((await ann.get(`/portal/calls/${bobs.id}.ics`)).status, 404);
  assert.equal(problemOf(await ann.post(`/portal/calls/${bobs.id}/cancel`, {})), "That call isn’t one of yours.");
  assert.equal(problemOf(await ann.post(`/portal/calls/${bobs.id}/move`, { start: (await slots())[0]?.start ?? "" })), "That call isn’t one of yours.");
  assert.doesNotMatch(await ann.page(`/portal/book?move=${bobs.id}`), /Move your call|Feed store/);
  assert.doesNotMatch(await ann.page("/portal"), /Feed store hours/);
  assert.equal(t.db.prepare("select status from booking where id = ?").get(bobs.id)?.["status"], "booked");
  // Nobody signed in.
  assert.equal((await (await import("../support/harness.ts")).httpClient(t.origin).get(`/portal/calls/${bobs.id}.ics`)).status, 404);
});
