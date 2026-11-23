import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarFile, cancel, changeable, checkBooker, whenText, type Booking } from "./booking.ts";
import { checkRules, clockLabel, DEFAULT_RULES, hoursSummary, isOpen, openSlots, parseClock, type BookingRules } from "./hours.ts";
import type { Id } from "../../shared/domain/id.ts";

const NY = "America/New_York";
// Mondays 9:00 to 12:00, 30-minute calls, 15 minutes between.
const rules: BookingRules = { ...DEFAULT_RULES, callMinutes: 30, gapMinutes: 15, noticeHours: 0, daysAhead: 8, hours: [{ weekday: 1, start: 540, end: 720 }] };
// Sunday Nov 22 2026, 12:00 New York.
const SUNDAY_NOON = "2026-11-22T17:00:00Z";
const labels = (days: ReturnType<typeof openSlots>) => days.map((day) => `${day.day} ${day.slots.map((slot) => slot.label).join(" ")}`);

test("open times start each range, one call and one gap apart, in the business's time zone", () => {
  const days = openSlots(rules, [], SUNDAY_NOON, NY);
  assert.deepEqual(labels(days), ["2026-11-23 9:00 AM 9:45 AM 10:30 AM 11:15 AM", "2026-11-30 9:00 AM 9:45 AM 10:30 AM 11:15 AM"]);
  assert.equal(days[0]?.slots[0]?.start, "2026-11-23T14:00:00Z", "9:00 in New York in November is 14:00 UTC");
  assert.equal(days[0]?.slots[0]?.end, "2026-11-23T14:30:00Z");
});

test("the notice, closed days and how far ahead all hold", () => {
  assert.deepEqual(labels(openSlots({ ...rules, noticeHours: 22 }, [], SUNDAY_NOON, NY))[0], "2026-11-23 10:30 AM 11:15 AM", "22 hours from Sunday noon is Monday 10:00");
  assert.deepEqual(labels(openSlots({ ...rules, closedDays: ["2026-11-23"] }, [], SUNDAY_NOON, NY)), ["2026-11-30 9:00 AM 9:45 AM 10:30 AM 11:15 AM"]);
  assert.equal(openSlots({ ...rules, daysAhead: 1 }, [], SUNDAY_NOON, NY).length, 1);
  assert.deepEqual(openSlots({ ...rules, hours: [] }, [], SUNDAY_NOON, NY), []);
});

test("a busy time takes out every slot it touches, with the gap on either side", () => {
  // Busy 9:50 to 10:20: the 9:45 slot overlaps it; 10:30 starts 10 minutes after, inside the 15-minute gap.
  const busy = [{ start: "2026-11-23T14:50:00Z", end: "2026-11-23T15:20:00Z" }];
  assert.deepEqual(labels(openSlots(rules, busy, SUNDAY_NOON, NY))[0], "2026-11-23 9:00 AM 11:15 AM");
  assert.deepEqual(isOpen(rules, busy, SUNDAY_NOON, NY, "2026-11-23T14:00:00Z"), { end: "2026-11-23T14:30:00Z" });
  assert.equal(isOpen(rules, busy, SUNDAY_NOON, NY, "2026-11-23T14:45:00Z"), null);
  assert.equal(isOpen(rules, [], SUNDAY_NOON, NY, "2026-11-23T14:10:00Z"), null, "not a slot start");
});

test("clock changes: a skipped time has no call; the hours stay on the wall clock", () => {
  // Sunday March 8 2026, clocks go from 2:00 to 3:00 in New York.
  const spring: BookingRules = { ...rules, gapMinutes: 0, callMinutes: 60, daysAhead: 1, hours: [{ weekday: 7, start: 60, end: 240 }] };
  assert.deepEqual(labels(openSlots(spring, [], "2026-03-08T05:00:00Z", NY)), ["2026-03-08 1:00 AM 3:00 AM"]);
  // Monday after the change, 9:00 is 13:00 UTC, not 14:00.
  assert.equal(openSlots({ ...rules, daysAhead: 1 }, [], "2026-03-09T05:00:00Z", NY)[0]?.slots[0]?.start, "2026-03-09T13:00:00Z");
});

test("rules are checked", () => {
  assert.equal(checkRules(rules).ok, true);
  assert.deepEqual(checkRules({ ...rules, callMinutes: 25 }), { ok: false, error: "call-length" });
  assert.deepEqual(checkRules({ ...rules, gapMinutes: 61 }), { ok: false, error: "gap" });
  assert.deepEqual(checkRules({ ...rules, daysAhead: 0 }), { ok: false, error: "days-ahead" });
  assert.equal(checkRules({ ...rules, hours: [{ weekday: 1, start: 540, end: 560 }] }).ok, true, "shorter than a call is allowed; it has no open time");
  assert.deepEqual(checkRules({ ...rules, hours: [{ weekday: 1, start: 540, end: 540 }] }), { ok: false, error: "hours-invalid" });
  assert.deepEqual(checkRules({ ...rules, hours: [{ weekday: 1, start: 540, end: 720 }, { weekday: 1, start: 700, end: 800 }] }), { ok: false, error: "hours-overlap" });
  assert.deepEqual(parseClock("9:00"), 540);
  assert.equal(parseClock("24:00"), 1440);
  assert.equal(parseClock("9am"), null);
  assert.equal(clockLabel(0), "12:00 AM");
  assert.equal(clockLabel(780), "1:00 PM");
  assert.equal(hoursSummary(rules.hours)[0]?.text, "9:00 AM to 12:00 PM");
  assert.equal(hoursSummary(rules.hours)[1]?.text, "No calls");
});

const booking: Booking = {
  id: "11111111-1111-4111-8111-111111111111" as Id,
  kind: "public",
  status: "booked",
  start: "2026-11-23T14:00:00Z",
  end: "2026-11-23T14:30:00Z",
  name: "Dale Pruitt",
  email: "dale@example.com",
  phone: "",
  topic: "A website for the farm; prices, and a map.",
  organizationId: null,
  clientUserId: null,
  hostId: "22222222-2222-4222-8222-222222222222" as Id,
  createdAt: SUNDAY_NOON,
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: "",
};

test("who is booking is checked", () => {
  assert.deepEqual(checkBooker({ name: "  Dale   Pruitt ", email: "Dale@Example.com", phone: "(304) 555-0134" }), { ok: true, value: { name: "Dale Pruitt", email: "dale@example.com", phone: "(304) 555-0134", topic: "" } });
  assert.deepEqual(checkBooker({ name: "", email: "a@b.co" }), { ok: false, error: "name-missing" });
  assert.deepEqual(checkBooker({ name: "Dale", email: "dale" }), { ok: false, error: "email-invalid" });
  assert.deepEqual(checkBooker({ name: "Dale", email: "a@b.co", phone: "call me" }), { ok: false, error: "phone-invalid" });
});

test("a call can be cancelled until it starts, once", () => {
  const done = cancel(booking, "booker", " Rain day ", SUNDAY_NOON);
  assert.equal(done.ok && done.value.status, "cancelled");
  assert.equal(done.ok && done.value.cancelReason, "Rain day");
  assert.deepEqual(done.ok && cancel(done.value, "staff", "", SUNDAY_NOON), { ok: false, error: "already-cancelled" });
  assert.deepEqual(cancel(booking, "staff", "", "2026-11-23T14:00:00Z"), { ok: false, error: "in-the-past" });
  assert.equal(changeable(booking, SUNDAY_NOON), true);
  assert.equal(whenText(booking.start, booking.end, NY), "Mon, Nov 23, 9:00 AM to 9:30 AM");
});

test("the calendar file opens in calendar apps, and a cancelled call is sent as cancelled", () => {
  const file = calendarFile(booking, { title: "Call with Potomac Solutions", description: "A website for the farm; prices, and a map.", organizer: "hello@potomac.solutions", stamp: SUNDAY_NOON });
  assert.match(file, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(file, /\r\nUID:11111111-1111-4111-8111-111111111111@potomac-hq\r\n/);
  assert.match(file, /\r\nDTSTART:20261123T140000Z\r\nDTEND:20261123T143000Z\r\n/);
  assert.ok(file.includes("\r\nDESCRIPTION:A website for the farm\\; prices\\, and a map.\r\n"), "text is escaped");
  assert.match(file, /STATUS:CONFIRMED/);
  for (const line of file.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  const long = calendarFile(booking, { title: "x", description: "word ".repeat(40), organizer: "a@b.co", stamp: SUNDAY_NOON });
  assert.match(long, /\r\n d word/, "a long line is folded, the next line starting with a space");
  const cancelled = calendarFile({ ...booking, status: "cancelled" }, { title: "x", description: "", organizer: "a@b.co", stamp: SUNDAY_NOON });
  assert.match(cancelled, /METHOD:CANCEL/);
  assert.match(cancelled, /STATUS:CANCELLED/);
});
