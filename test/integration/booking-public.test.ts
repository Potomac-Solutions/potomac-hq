// The public booking page over real HTTP: anyone books a time, then moves or
// cancels it with the private link. Bots and floods are turned away.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openTimes } from "../../src/booking/index.ts";
import { actions, httpClient, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
const allWeek = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].flatMap((day) => [[`start-${day}-0`, "00:00"], [`end-${day}-0`, "23:00"]]));
const hours = (open: boolean) => ({ ...allWeek, "call-minutes": "60", "gap-minutes": "0", "notice-hours": "1", "days-ahead": "14", ...(open ? { "public-open": "1" } : {}) });
const slots = async () => (await openTimes(t.services.booking, "public")).days.flatMap((day) => day.slots);
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const bookings = () => Number(t.db.prepare("select count(*) as n from booking").get()?.["n"]);
let manageLink = "";

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
});
after(() => t.stop());

test("closed: the page says how to reach a person instead, and posts are refused", async () => {
  await admin.post("/calls/hours", hours(false));
  const page = await httpClient(t.origin).get("/book");
  assert.equal(page.status, 200);
  const text = textOf(await page.text());
  assert.match(text, /Book a call with Potomac Solutions Booking online isn’t open right now\./);
  assert.doesNotMatch(text, /Dashboard|Pipeline|Sign out/, "nothing of HQ");
  assert.equal(problemOf(await httpClient(t.origin).post("/book", { name: "Dale", email: "dale@example.com", start: "2099-01-01T14:00:00Z" })), "Booking online isn’t open right now. Call or write instead.");
});

test("anyone books an open time and lands on their call's private page", async () => {
  await admin.post("/calls/hours", hours(true));
  const visitor = httpClient(t.origin);
  const page = await visitor.page("/book");
  assert.match(textOf(page), /A 60-minute call, free, about your business and what would help\. Times are Eastern\./);
  const slot = (await slots())[2];
  assert.ok(slot);
  assert.ok(page.includes(`value="${slot.start}"`));

  assert.equal(problemOf(await visitor.post("/book", { name: "", email: "dale@example.com", start: slot.start })), "Enter your name.");
  assert.equal(problemOf(await visitor.post("/book", { name: "Dale Pruitt", email: "dale", start: slot.start })), "Enter your email, like you@example.com.");

  const made = await visitor.post("/book", { name: "Dale Pruitt", email: "Dale@Example.com", phone: "304-555-0134", topic: "A website for the farm stand", start: slot.start });
  assert.equal(doneOf(made), "You’re booked. We’ll talk then.");
  manageLink = (made.headers.get("location") ?? "").replace(/&done=.*$/, "");
  assert.match(manageLink, /^\/book\/manage\?token=[A-Za-z0-9_-]{43}$/);
  const mine = textOf(await visitor.page(manageLink));
  assert.match(mine, /Your call with Potomac Solutions .* Eastern time Dale Pruitt · dale@example\.com · 304-555-0134 A website for the farm stand Keep this page’s address, by bookmarking it/);
  const stored = JSON.stringify(t.db.prepare("select * from booking").all());
  assert.ok(!stored.includes(manageLink.split("token=")[1] as string), "only a hash of the link is kept");

  // HQ sees it.
  assert.match(textOf(await admin.page("/calls")), /Dale Pruitt Booking page dale@example\.com/);
  // And nobody else gets the time.
  assert.equal(problemOf(await httpClient(t.origin).post("/book", { name: "Eve", email: "eve@example.com", start: slot.start })), "That time was just taken. Choose another.");
});

test("with the link: a calendar file, a move, and a cancel; without it, nothing", async () => {
  const token = manageLink.split("token=")[1] as string;
  const visitor = httpClient(t.origin);
  const file = await visitor.get(`/book/manage/call.ics?token=${token}`);
  assert.equal(file.status, 200);
  assert.match(await file.text(), /SUMMARY:Call with Potomac Solutions: Dale Pruitt/);
  assert.equal((await visitor.get("/book/manage/call.ics?token=nope")).status, 404);
  assert.match(textOf(await visitor.page("/book/manage?token=nope")), /Link not found/);

  assert.match(textOf(await visitor.page(`${manageLink}&move=1`)), /Choose a new time Keep the time you have/);
  const to = (await slots()).at(-1);
  assert.ok(to);
  assert.equal(doneOf(await visitor.post("/book/manage/move", { token, start: to.start })), "Your call is moved. Add it to your calendar again to update it there.");
  assert.equal(t.db.prepare("select starts_at from booking").get()?.["starts_at"], to.start);
  assert.equal(problemOf(await visitor.post("/book/manage/move", { token: "nope", start: to.start })), "This link doesn’t match a booking.");

  assert.equal(problemOf(await visitor.post("/book/manage/cancel", { token: "nope" })), "This link doesn’t match a booking.");
  assert.equal(doneOf(await visitor.post("/book/manage/cancel", { token, reason: "Hired someone local" })), "Your call is cancelled.");
  assert.match(textOf(await visitor.page(manageLink)), /Your call is cancelled .* Cancelled by Dale Pruitt: Hired someone local Book another time/);
  assert.ok(actions(t.db).includes("booking.moved") && actions(t.db).includes("booking.cancelled"));
});

test("a bot that fills the hidden field books nothing; a flood from one address is turned away", async () => {
  const before = bookings();
  const slot = (await slots())[0];
  assert.ok(slot);
  const bot = await httpClient(t.origin).post("/book", { name: "Bot", email: "bot@example.com", website: "http://spam.example", start: slot.start });
  assert.equal(bot.headers.get("location"), "/book");
  assert.equal(bookings(), before);

  // Five an hour from one address. Two are used above (Dale, and Eve's refused try); three more fit.
  const flood = httpClient(t.origin);
  const answers: string[] = [];
  for (let n = 0; n < 4; n++) {
    const next = (await slots())[n + 1];
    answers.push(problemOf(await flood.post("/book", { name: `Flood ${n}`, email: `flood${n}@example.com`, start: next?.start ?? "" })));
  }
  assert.equal(answers.at(-1), "That’s a lot of bookings at once. Call or write instead, and we’ll find a time.");
});
