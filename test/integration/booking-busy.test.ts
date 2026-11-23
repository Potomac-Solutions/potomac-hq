// Booking with another calendar's busy times, over real HTTP: a busy time is
// not offered and cannot be booked; a calendar that cannot be read offers
// nothing rather than something wrong.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { bookCall, openTimes, type BusyCalendar } from "../../src/booking/index.ts";
import { httpClient, signIn, testApp, textOf, type TestApp } from "../support/harness.ts";

let busy: { start: string; end: string }[] = [];
let broken = false;
const calendar: BusyCalendar = {
  name: "Google Calendar mikey@example.com",
  busy: async () => {
    if (broken) throw new Error("Google Calendar free/busy failed: HTTP 503");
    return busy;
  },
};
let t: TestApp;
const allWeek = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].flatMap((day) => [[`start-${day}-0`, "00:00"], [`end-${day}-0`, "23:00"]]));
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";

before(async () => {
  t = await testApp({ busyCalendar: calendar });
  const admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  await admin.post("/calls/hours", { ...allWeek, "call-minutes": "60", "gap-minutes": "0", "notice-hours": "1", "days-ahead": "14", "public-open": "1" });
  assert.match(textOf(await admin.page("/calls/hours")), /Open times also avoid busy times in Google Calendar mikey@example\.com\./);
});
after(() => t.stop());

test("a busy time in the other calendar is not offered, and cannot be booked", async () => {
  const slot = (await openTimes(t.services.booking, "public")).days[1]?.slots[2];
  assert.ok(slot);
  busy = [{ start: slot.start, end: slot.end }];
  const deps = { ...t.services.booking, busy: calendar };
  assert.ok(!(await openTimes(deps, "public")).days.flatMap((day) => day.slots).some((one) => one.start === slot.start));
  assert.deepEqual(await bookCall(deps, { kind: "public", name: "Dale", email: "dale@example.com" }, slot.start), { ok: false, error: "taken" });
});

test("when the calendar cannot be read, no times are offered and nothing is booked", async () => {
  broken = true;
  assert.equal((await openTimes({ ...t.services.booking, busy: calendar }, "public")).calendarFailed, true);
  const any = "2099-01-01T14:00:00Z";
  assert.deepEqual(await bookCall({ ...t.services.booking, busy: calendar }, { kind: "public", name: "Dale", email: "dale@example.com" }, any), { ok: false, error: "calendar-failed" });
  assert.equal(t.db.prepare("select count(*) as n from booking").get()?.["n"], 0);
  broken = false;
});
