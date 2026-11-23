// The public booking page over real HTTP: booking needs an account now, so
// /book sends people to sign up or sign in. A call booked from the old form
// keeps its private link: a calendar file, a move and a cancel.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { bookCall, openTimes } from "../../src/booking/index.ts";
import { actions, httpClient, signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
const allWeek = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].flatMap((day) => [[`start-${day}-0`, "00:00"], [`end-${day}-0`, "23:00"]]));
const hours = (open: boolean) => ({ ...allWeek, "call-minutes": "60", "gap-minutes": "0", "notice-hours": "1", "days-ahead": "14", ...(open ? { "public-open": "1" } : {}) });
const slots = async () => (await openTimes(t.services.booking, "public")).days.flatMap((day) => day.slots);
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
});
after(() => t.stop());

test("closed, or with no email to confirm a sign-up: the page says how to reach a person", async () => {
  await admin.post("/calls/hours", hours(false));
  const text = textOf(await httpClient(t.origin).page("/book"));
  assert.match(text, /Book a call with Potomac Solutions Booking online isn’t open right now\./);
  assert.doesNotMatch(text, /Dashboard|Pipeline|Sign out/, "nothing of HQ");
  // Open, but this HQ can't send email, so nobody can confirm a sign-up.
  await admin.post("/calls/hours", hours(true));
  assert.match(textOf(await httpClient(t.origin).page("/book")), /Booking online isn’t open right now\./);
  assert.match(textOf(await httpClient(t.origin).page("/portal/sign-up")), /Signing up online isn’t open right now\./);
  assert.equal(problemOf(await httpClient(t.origin).post("/portal/sign-up", { name: "Dale", email: "dale@example.com" })), "Signing up isn’t open right now. Call or write, and we’ll find a time.");
  assert.equal((await httpClient(t.origin).post("/book", { name: "Dale", email: "dale@example.com", start: "2099-01-01T14:00:00Z" })).status, 404, "the account-free form is gone");
});

test("a call booked before accounts were needed keeps its link: a calendar file, a move, a cancel", async () => {
  const slot = (await slots())[2];
  assert.ok(slot);
  const made = unwrap(await bookCall(t.services.booking, { kind: "public", name: "Dale Pruitt", email: "dale@example.com", phone: "304-555-0134", topic: "A website for the farm stand" }, slot.start));
  const token = made.manageToken ?? "";
  const manageLink = `/book/manage?token=${token}`;
  const visitor = httpClient(t.origin);
  assert.match(textOf(await visitor.page(manageLink)), /Your call with Potomac Solutions .* Dale Pruitt · dale@example\.com · 304-555-0134 A website for the farm stand/);
  const file = await visitor.get(`/book/manage/call.ics?token=${token}`);
  assert.equal(file.status, 200);
  assert.match(await file.text(), /SUMMARY:Call with Potomac Solutions: Dale Pruitt/);
  assert.equal((await visitor.get("/book/manage/call.ics?token=nope")).status, 404);
  assert.match(textOf(await visitor.page("/book/manage?token=nope")), /Link not found/);
  const to = (await slots()).at(-1);
  assert.ok(to);
  assert.equal(doneOf(await visitor.post("/book/manage/move", { token, start: to.start })), "Your call is moved. Add it to your calendar again to update it there.");
  assert.equal(problemOf(await visitor.post("/book/manage/move", { token: "nope", start: to.start })), "This link doesn’t match a booking.");
  assert.equal(doneOf(await visitor.post("/book/manage/cancel", { token, reason: "Hired someone local" })), "Your call is cancelled.");
  assert.ok(actions(t.db).includes("booking.moved") && actions(t.db).includes("booking.cancelled"));
});
