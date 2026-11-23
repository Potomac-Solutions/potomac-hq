// The availability grid over real HTTP: paint the usual week, paint one week
// differently, see busy times and calls underneath, and the open times follow.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openTimes } from "../../src/booking/index.ts";
import { createServices } from "../../src/services.ts";
import { actions, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const nextMonday = () => {
  const today = Temporal.Now.plainDateISO("America/New_York");
  return today.add({ days: 8 - today.dayOfWeek });
};
/** Paints 9:00 to 11:00 on the given column keys. */
const paint = (keys: readonly string[], from = 540, to = 660) => Object.fromEntries(keys.flatMap((key) => Array.from({ length: (to - from) / 30 }, (_, n) => [`c-${key}-${from + n * 30}`, "1"])));

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  member = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await admin.get("/");
  await member.get("/");
});
after(() => t.stop());

test("the usual week is painted on the grid, and only by someone who manages booking", async () => {
  const page = textOf(await admin.page("/calls/hours"));
  assert.match(page, /Your usual week Paint the half hours you’re free for calls\./);
  assert.equal((await member.get("/calls/availability")).status, 403);
  assert.match(problemOf(await member.post("/calls/hours/week", paint(["1"]))), /permission/);
  await admin.post("/calls/hours/week", paint(["1", "2", "3", "4", "5"]));
  const saved = t.db.prepare("select weekday, start, end from booking_hours order by weekday").all().map((row) => ({ ...row }));
  assert.deepEqual(saved, [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: 540, end: 660 })));
  assert.ok(actions(t.db).includes("booking.hours-changed"));
  const html = await (await admin.get("/calls/hours")).text();
  assert.match(html, /name="c-1-540" value="1" checked/);
  assert.doesNotMatch(html, /name="c-6-540" value="1" checked/);
});

test("one week is painted differently: Monday off, Tuesday afternoon instead", async () => {
  const monday = nextMonday();
  const tuesday = monday.add({ days: 1 });
  const keep = [2, 3, 4].map((n) => monday.add({ days: n }).toString());
  await admin.post("/calls/availability", { week: monday.toString(), ...paint(keep), ...paint([tuesday.toString()], 840, 900) });
  const painted = t.db.prepare("select d.day, h.start, h.end from booking_date d left join booking_date_hours h on h.day = d.day order by d.day").all().map((row) => ({ ...row }));
  assert.deepEqual(painted, [
    { day: monday.toString(), start: null, end: null },
    { day: tuesday.toString(), start: 840, end: 900 },
  ], "only the days that differ are kept");
  const page = textOf(await admin.page(`/calls/availability?week=${monday}`));
  assert.match(page, /Week of .* Free for calls Busy in your calendar A call already booked/);
  const services = createServices(t.db);
  t.db.prepare("update booking_setting set portal_open = 1, notice_hours = 0, days_ahead = 30").run();
  const open = await openTimes(services.booking, "portal");
  const days = new Map(open.days.map((one) => [one.day, one]));
  assert.equal(days.get(monday.toString()), undefined, "Monday that week is off");
  assert.deepEqual(days.get(tuesday.toString())?.slots.map((one) => one.label), ["2:00 PM"]);
  assert.ok(days.get(monday.add({ days: 7 }).toString()), "the Monday after is the usual week again");
});

test("painting a day back to usual removes the change", async () => {
  const monday = nextMonday();
  const week = [0, 1, 2, 3, 4].map((n) => monday.add({ days: n }).toString());
  await admin.post("/calls/availability", { week: monday.toString(), ...paint(week) });
  assert.equal(t.db.prepare("select count(*) as n from booking_date").get()?.["n"], 0);
});
