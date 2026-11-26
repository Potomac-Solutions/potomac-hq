import assert from "node:assert/strict";
import { test } from "node:test";
import { allDayCalendar } from "./calendar-file.ts";

test("an all-day calendar: escaped text, a day-after end, folded lines", () => {
  const file = allDayCalendar(
    "Mikey's HQ",
    [
      { uid: "task-1@potomac-hq", summary: "Send the proof; then, call", description: "Line one\nLine two", url: "https://hq.example.com/tasks/1", start: "2026-11-30", end: "2026-11-30" },
      { uid: "task-2@potomac-hq", summary: "x".repeat(120), description: "", url: "https://hq.example.com/tasks/2", start: "2026-12-01", end: "2026-12-04" },
    ],
    "2026-11-24T19:00:00.123Z",
  );
  assert.match(file, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(file, /X-WR-CALNAME:Mikey's HQ\r\n/);
  assert.match(file, /DTSTAMP:20261124T190000Z\r\n/);
  assert.match(file, /DTSTART;VALUE=DATE:20261130\r\nDTEND;VALUE=DATE:20261201\r\n/);
  assert.match(file, /SUMMARY:Send the proof\\; then\\, call\r\n/);
  assert.match(file, /DESCRIPTION:Line one\\nLine two\r\n/);
  assert.match(file, /DTSTART;VALUE=DATE:20261201\r\nDTEND;VALUE=DATE:20261205\r\n/);
  for (const line of file.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.match(file, /SUMMARY:x{67}\r\n x{53}\r\n/, "folded with a leading space");
  assert.ok(file.endsWith("END:VCALENDAR\r\n"));
});

test("an event at a time has a start and end in UTC, and is busy", async () => {
  const { allDayCalendar } = await import("./calendar-file.ts");
  const file = allDayCalendar("HQ", [{ uid: "call-1@potomac-hq", summary: "Call with Stacy", description: "", url: "https://hq.example/calls", start: "2026-11-30", end: "2026-11-30", at: { start: "2026-11-30T19:30:00Z", end: "2026-11-30T20:00:00Z" } }], "2026-11-25T00:00:00Z");
  assert.match(file, /DTSTART:20261130T193000Z\r\nDTEND:20261130T200000Z/);
  assert.match(file, /TRANSP:OPAQUE/);
});
