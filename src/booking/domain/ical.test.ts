import assert from "node:assert/strict";
import { test } from "node:test";
import { busyFromCalendar } from "./ical.ts";

const NY = "America/New_York";
const calendar = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.flatMap((event) => ["BEGIN:VEVENT", ...event.split("\n"), "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");
const busy = (text: string, from = "2026-12-01T00:00:00Z", to = "2026-12-15T00:00:00Z") => busyFromCalendar(text, from, to, NY)?.map((one) => `${one.start} ${one.end}`);

test("what isn't a calendar is null; an empty one is no busy times", () => {
  assert.equal(busyFromCalendar("<html>Sign in</html>", "2026-12-01T00:00:00Z", "2026-12-02T00:00:00Z", NY), null);
  assert.deepEqual(busy(calendar()), []);
});

test("timed events: in UTC, in a named zone, in Outlook's zone names, floating, and by duration", () => {
  assert.deepEqual(busy(calendar("DTSTART:20261202T150000Z\nDTEND:20261202T160000Z")), ["2026-12-02T15:00:00Z 2026-12-02T16:00:00Z"]);
  assert.deepEqual(busy(calendar("DTSTART;TZID=America/Chicago:20261202T090000\nDTEND;TZID=America/Chicago:20261202T093000")), ["2026-12-02T15:00:00Z 2026-12-02T15:30:00Z"]);
  assert.deepEqual(busy(calendar('DTSTART;TZID="Pacific Standard Time":20261202T090000\nDURATION:PT1H30M')), ["2026-12-02T17:00:00Z 2026-12-02T18:30:00Z"]);
  assert.deepEqual(busy(calendar("DTSTART:20261202T090000\nDTEND:20261202T100000")), ["2026-12-02T14:00:00Z 2026-12-02T15:00:00Z"], "no zone: the business's");
});

test("free, cancelled and zero-length events are left out; a busy all-day event takes the day", () => {
  assert.deepEqual(busy(calendar("DTSTART:20261202T150000Z\nDTEND:20261202T160000Z\nTRANSP:TRANSPARENT", "DTSTART:20261203T150000Z\nDTEND:20261203T160000Z\nSTATUS:CANCELLED", "DTSTART:20261204T150000Z")), []);
  assert.deepEqual(busy(calendar("DTSTART;VALUE=DATE:20261205\nDTEND;VALUE=DATE:20261207")), ["2026-12-05T05:00:00Z 2026-12-07T05:00:00Z"]);
});

test("long lines are unfolded, alarms inside an event are ignored, and touching events join up", () => {
  const text = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:20261202T1500", " 00Z", "DTEND:20261202T160000Z", "BEGIN:VALARM", "TRIGGER:-PT10M", "DTSTART:20200101T000000Z", "END:VALARM", "END:VEVENT", "BEGIN:VEVENT", "DTSTART:20261202T160000Z", "DTEND:20261202T170000Z", "END:VEVENT", "END:VCALENDAR"].join("\n");
  assert.deepEqual(busy(text), ["2026-12-02T15:00:00Z 2026-12-02T17:00:00Z"]);
});

test("weekly on chosen days keeps its wall-clock time across a clock change", () => {
  const text = calendar("DTSTART;TZID=America/New_York:20261026T090000\nDTEND;TZID=America/New_York:20261026T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO,TH");
  assert.deepEqual(busy(text, "2026-10-29T00:00:00Z", "2026-11-06T00:00:00Z"), ["2026-10-29T13:00:00Z 2026-10-29T14:00:00Z", "2026-11-02T14:00:00Z 2026-11-02T15:00:00Z", "2026-11-05T14:00:00Z 2026-11-05T15:00:00Z"]);
});

test("a rule stops at its count or its end, and runs every other week", () => {
  const start = "DTSTART:20261201T150000Z\nDTEND:20261201T153000Z\n";
  assert.equal(busy(calendar(`${start}RRULE:FREQ=DAILY;COUNT=3`))?.length, 3);
  assert.equal(busy(calendar(`${start}RRULE:FREQ=DAILY;UNTIL=20261204T000000Z`))?.length, 3);
  assert.equal(busy(calendar(`${start}RRULE:FREQ=DAILY;UNTIL=20261204`))?.length, 4, "a date alone runs through that day");
  assert.deepEqual(busy(calendar(`${start}RRULE:FREQ=WEEKLY;INTERVAL=2`)), ["2026-12-01T15:00:00Z 2026-12-01T15:30:00Z"]);
  assert.deepEqual(busy(calendar(`${start}RRULE:FREQ=DAILY;BYDAY=SA,SU`), "2026-12-01T00:00:00Z", "2026-12-08T00:00:00Z")?.map((one) => one.slice(0, 10)), ["2026-12-05", "2026-12-06"]);
});

test("an old daily event is still found years later", () => {
  const text = calendar("DTSTART:20100104T150000Z\nDTEND:20100104T151500Z\nRRULE:FREQ=DAILY");
  assert.equal(busy(text, "2026-12-01T00:00:00Z", "2026-12-04T00:00:00Z")?.length, 3);
});

test("monthly: by day of the month, the second Tuesday, the last Friday; yearly", () => {
  const range = ["2026-12-01T00:00:00Z", "2027-03-01T00:00:00Z"] as const;
  const days = (rule: string, start = "20261110") => busy(calendar(`DTSTART:${start}T150000Z\nDTEND:${start}T160000Z\nRRULE:${rule}`), ...range)?.map((one) => one.slice(0, 10));
  assert.deepEqual(days("FREQ=MONTHLY"), ["2026-12-10", "2027-01-10", "2027-02-10"]);
  assert.deepEqual(days("FREQ=MONTHLY;BYDAY=2TU"), ["2026-12-08", "2027-01-12", "2027-02-09"]);
  assert.deepEqual(days("FREQ=MONTHLY;BYDAY=-1FR"), ["2026-12-25", "2027-01-29", "2027-02-26"]);
  assert.deepEqual(days("FREQ=MONTHLY;BYMONTHDAY=1,-1"), ["2026-12-01", "2026-12-31", "2027-01-01", "2027-01-31", "2027-02-01", "2027-02-28"]);
  assert.deepEqual(days("FREQ=MONTHLY", "20261031"), ["2026-12-31", "2027-01-31"], "a month without a 31st is skipped");
  assert.deepEqual(days("FREQ=YEARLY", "20200115"), ["2027-01-15"]);
});

test("skipped dates are left out, and a moved occurrence is busy only where it was moved to", () => {
  const master = "UID:standup\nDTSTART;TZID=America/New_York:20261201T090000\nDTEND;TZID=America/New_York:20261201T093000\nRRULE:FREQ=DAILY;COUNT=4\nEXDATE;TZID=America/New_York:20261202T090000";
  const moved = "UID:standup\nRECURRENCE-ID;TZID=America/New_York:20261203T090000\nDTSTART;TZID=America/New_York:20261203T140000\nDTEND;TZID=America/New_York:20261203T143000";
  assert.deepEqual(busy(calendar(master, moved)), ["2026-12-01T14:00:00Z 2026-12-01T14:30:00Z", "2026-12-03T19:00:00Z 2026-12-03T19:30:00Z", "2026-12-04T14:00:00Z 2026-12-04T14:30:00Z"]);
});
