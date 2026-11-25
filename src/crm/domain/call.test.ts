import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { addBusinessDays, fillScript, readReturnTo, startsText, callClock, changeLength, forgotten, keepNote, lengthText, loggedMinutes, plannedFromBooking, setLength, startCall, timerText, warnMinutesFor, type Call } from "./call.ts";

const AT = "2026-11-25T15:00:00.000Z";
const ids = { id: "c1" as Id, organizationId: "o1" as Id, contactId: null, opportunityId: null, bookingId: null, userId: "u1" as Id, phone: "304-555-0100", startedAt: AT };
const call = (): Call => {
  const made = startCall(ids, 15);
  assert.ok(made.ok);
  return made.value;
};
const later = (minutes: number, seconds = 0) => new Date(Date.parse(AT) + minutes * 60_000 + seconds * 1000).toISOString();

test("a call is planned for 30 minutes unless it was booked", () => {
  const usual = startCall(ids);
  assert.ok(usual.ok);
  assert.deepEqual([usual.value.plannedMinutes, usual.value.warnMinutes], [30, 5]);
  assert.equal(plannedFromBooking("2026-11-25T15:00:00Z", "2026-11-25T15:30:00Z"), 30);
  assert.equal(plannedFromBooking("2026-11-25T15:00:00Z", "2026-11-25T15:22:00Z"), 20, "rounded to 5 minutes");
  assert.equal(plannedFromBooking("2026-11-25T15:00:00Z", "2026-11-25T15:01:00Z"), 5, "never under 5");
  assert.equal(plannedFromBooking("2026-11-25T15:00:00Z", "2026-11-26T15:00:00Z"), 240, "never over 4 hours");
  assert.deepEqual(startCall(ids, 7), { ok: false, error: "invalid-length" });
});

test("wrapping up starts 5 minutes before the end, or a third of a short call before", () => {
  assert.equal(warnMinutesFor(60), 5);
  assert.equal(warnMinutesFor(15), 5);
  assert.equal(warnMinutesFor(10), 3);
  assert.equal(warnMinutesFor(5), 2);
});

test("the clock: on, then wrapping up, then over and counting", () => {
  const one = call();
  assert.deepEqual({ ...callClock(one, later(0)), wrapUpAt: "", endsAt: "" }, { phase: "on", elapsed: 0, left: 900, wrapUpAt: "", endsAt: "" });
  assert.equal(callClock(one, later(9, 59)).phase, "on");
  assert.equal(callClock(one, later(10)).phase, "wrap-up");
  assert.equal(callClock(one, later(10)).wrapUpAt, later(10));
  assert.equal(callClock(one, later(15)).phase, "over");
  assert.equal(callClock(one, later(17, 30)).left, -150, "overtime counts up");
  assert.equal(callClock({ ...one, endedAt: later(12) }, later(50)).elapsed, 720, "an ended call's clock stops");
});

test("the length moves in 5-minute steps, and the warning with it", () => {
  const longer = changeLength(call(), 1);
  assert.ok(longer.ok);
  assert.equal(longer.value.plannedMinutes, 20);
  const short = changeLength(call(), -1);
  assert.ok(short.ok);
  assert.deepEqual([short.value.plannedMinutes, short.value.warnMinutes], [10, 3]);
  assert.equal((changeLength(call(), -2) as { value: Call }).value.plannedMinutes, 5);
  assert.deepEqual(changeLength(call(), -3), { ok: false, error: "invalid-length" }, "never under 5");
  assert.deepEqual(changeLength(call(), 0), { ok: false, error: "invalid-length" });
  assert.deepEqual(changeLength({ ...call(), endedAt: later(3) }, 1), { ok: false, error: "call-ended" });
  assert.deepEqual(keepNote({ ...call(), endedAt: later(3) }, "x"), { ok: false, error: "call-ended" });
  const hour = setLength(call(), 60);
  assert.ok(hour.ok);
  assert.deepEqual([hour.value.plannedMinutes, hour.value.warnMinutes], [60, 5]);
  assert.deepEqual(setLength(call(), 17), { ok: false, error: "invalid-length" });
  assert.deepEqual(setLength({ ...call(), endedAt: later(3) }, 30), { ok: false, error: "call-ended" });
  assert.deepEqual(keepNote(call(), "x".repeat(2001)), { ok: false, error: "note-too-long" });
});

test("the log keeps whole minutes, and a forgotten call is ended after 3 hours", () => {
  assert.equal(loggedMinutes(AT, later(0, 20)), 1);
  assert.equal(loggedMinutes(AT, later(14, 1)), 15);
  assert.equal(forgotten(call(), later(179)), false);
  assert.equal(forgotten(call(), later(180)), true);
  assert.equal(forgotten({ ...call(), endedAt: later(5) }, later(500)), false);
});

test("timers and lengths read plainly", () => {
  assert.equal(timerText(245), "4:05");
  assert.equal(timerText(3729), "1:02:09");
  assert.equal(timerText(-150), "2:30");
  assert.equal(lengthText(14), "14 min");
  assert.equal(lengthText(65), "1 h 5 min");
  assert.equal(lengthText(120), "2 h");
});

test("trying again skips the weekend", () => {
  assert.equal(addBusinessDays("2026-11-25", 2), "2026-11-27", "Wednesday to Friday");
  assert.equal(addBusinessDays("2026-11-27", 2), "2026-12-01", "Friday to Tuesday");
  assert.equal(addBusinessDays("2026-11-28", 2), "2026-12-01", "Saturday to Tuesday");
});

test("the voicemail script fills its blanks, plainly when there's nothing to fill them", () => {
  const script = "Hi {name}, this is {me}, about {about}.";
  assert.equal(fillScript(script, { name: "Dale Hensley", me: "Mikey Nichols", about: "the new website" }), "Hi Dale, this is Mikey, about the new website.");
  assert.equal(fillScript(script, { name: "", me: "", about: "" }), "Hi there, this is me, about your project.");
  assert.equal(fillScript("{unknown} stays", { name: "a", me: "b", about: "c" }), "{unknown} stays");
});

test("a call only goes back to a page in HQ", () => {
  assert.equal(readReturnTo("/today#calls-to-make"), "/today#calls-to-make");
  for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "today", "", "/" + "x".repeat(200), "/a b"]) assert.equal(readReturnTo(bad), null, bad);
});

test("a booked call's start reads plainly", () => {
  assert.equal(startsText(later(12), AT), "in 12 minutes");
  assert.equal(startsText(later(1), AT), "in 1 minute");
  assert.equal(startsText(later(0, 20), AT), "now");
  assert.equal(startsText(AT, later(4)), "4 minutes ago");
});
