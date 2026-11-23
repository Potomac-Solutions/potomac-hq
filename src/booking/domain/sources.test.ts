import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarAddress, calendarSite, calendlySlots, calendlyTypes, calendlyUser, insideFree, readTimefulEvent, timefulEventId, timefulFree, timefulMarks, timefulPerson, touchesBusy } from "./sources.ts";

const NY = "America/New_York";
const ms = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;
const iso = (stretches: readonly (readonly [number, number])[]) => stretches.map(([a, b]) => `${Temporal.Instant.fromEpochMilliseconds(a)} ${Temporal.Instant.fromEpochMilliseconds(b)}`);

test("a calendar's address is https or webcal, with no sign-in inside it", () => {
  assert.equal(calendarAddress(" webcal://calendar.example/basic.ics "), "https://calendar.example/basic.ics");
  assert.equal(calendarAddress("https://calendar.google.com/calendar/ical/x/private-abc/basic.ics"), "https://calendar.google.com/calendar/ical/x/private-abc/basic.ics");
  for (const bad of ["http://calendar.example/a.ics", "ftp://calendar.example/a.ics", "https://me:pw@calendar.example/a.ics", "not a link", ""]) assert.equal(calendarAddress(bad), null, bad);
  assert.equal(calendarSite("https://www.calendar.example/secret/basic.ics"), "calendar.example");
});

test("a Timeful link gives its event id; anything else doesn't", () => {
  assert.equal(timefulEventId("https://timeful.app/e/fqQrJT"), "fqQrJT");
  assert.equal(timefulEventId("https://schej.it/e/abc123/"), "abc123");
  for (const bad of ["https://timeful.app/", "https://evil.example/e/fqQrJT", "http://timeful.app/e/fqQrJT", "https://timeful.app/e/../../x", "fqQrJT"]) assert.equal(timefulEventId(bad), null, bad);
});

const event = { _id: "65f0c0ffee65f0c0ffee65f0", name: "Kickoff", type: "specific_dates", timeIncrement: 15, dates: ["2026-12-01T14:00:00Z", "2026-12-02T14:00:00Z"], responses: { u1: { user: { firstName: "Ann", lastName: "Lee" } }, "Bo Diaz": { name: "Bo Diaz" }, gone: {} } };

test("a Timeful event: who answered, and which one is meant", () => {
  const read = readTimefulEvent(event);
  assert.ok(read.ok);
  assert.deepEqual(read.value.people, [{ key: "u1", name: "Ann Lee" }, { key: "Bo Diaz", name: "Bo Diaz" }]);
  assert.equal(read.value.from, ms("2026-11-30T14:00:00Z"));
  assert.equal(read.value.to, ms("2026-12-04T14:00:00Z"));
  assert.deepEqual(timefulPerson(read.value, "ann lee"), { ok: true, value: { key: "u1", name: "Ann Lee" } });
  assert.deepEqual(timefulPerson(read.value, "bo"), { ok: true, value: { key: "Bo Diaz", name: "Bo Diaz" } });
  assert.deepEqual(timefulPerson(read.value, ""), { ok: false, error: "timeful-who" });
  assert.deepEqual(timefulPerson(read.value, "Cy"), { ok: false, error: "timeful-who" });
  assert.deepEqual(timefulPerson({ ...read.value, people: [{ key: "u1", name: "Ann Lee" }] }, ""), { ok: true, value: { key: "u1", name: "Ann Lee" } }, "one person: no name needed");

  assert.deepEqual(readTimefulEvent({ ...event, daysOnly: true }), { ok: false, error: "timeful-days-only" });
  assert.deepEqual(readTimefulEvent({ ...event, responses: {} }), { ok: false, error: "timeful-empty" });
  assert.deepEqual(readTimefulEvent({ error: "event-not-found" }), { ok: false, error: "timeful-unreadable" });
  assert.deepEqual(readTimefulEvent("<html>"), { ok: false, error: "timeful-unreadable" });
});

test("Timeful marks become stretches of free time; quarter hours join up", () => {
  const read = readTimefulEvent(event);
  assert.ok(read.ok);
  const marks = timefulMarks({ u1: { availability: ["2026-12-01T14:00:00Z", "2026-12-01T14:15:00Z", "2026-12-01T15:00:00Z", "junk"], ifNeeded: ["2026-12-01T16:00:00Z"] } }, "u1");
  assert.equal(marks?.length, 3);
  assert.deepEqual(iso(timefulFree(read.value, marks ?? [], ms("2026-12-01T00:00:00Z"), ms("2026-12-02T00:00:00Z"), NY)), ["2026-12-01T14:00:00Z 2026-12-01T14:30:00Z", "2026-12-01T15:00:00Z 2026-12-01T15:15:00Z"]);
  assert.equal(timefulMarks({ u1: {} }, "u1"), null);
  assert.equal(timefulMarks({}, "u1"), null);
});

test("a Timeful poll over days of the week is laid over each such day", () => {
  const read = readTimefulEvent({ ...event, type: "dow", timezone: "America/New_York", timeIncrement: 30, dates: ["2018-06-18T04:00:00Z"] });
  assert.ok(read.ok);
  // Monday 9:00 and 9:30 Eastern, in the week Timeful stores such polls in.
  const marks = [ms("2018-06-18T13:00:00Z"), ms("2018-06-18T13:30:00Z")];
  assert.deepEqual(iso(timefulFree(read.value, marks, ms("2026-12-05T05:00:00Z"), ms("2026-12-15T05:00:00Z"), NY)), ["2026-12-07T14:00:00Z 2026-12-07T15:00:00Z", "2026-12-14T14:00:00Z 2026-12-14T15:00:00Z"]);
});

test("Calendly: the person, their event types and the times they can be booked", () => {
  assert.equal(calendlyUser({ resource: { uri: "https://api.calendly.com/users/AAA" } }), "https://api.calendly.com/users/AAA");
  assert.equal(calendlyUser({ resource: { uri: "https://evil.example/users/AAA" } }), null);
  assert.equal(calendlyUser({ message: "Unauthenticated" }), null);
  const types = calendlyTypes({ collection: [{ uri: "https://api.calendly.com/event_types/1", duration: 30, active: true }, { uri: "https://api.calendly.com/event_types/2", duration: 60, active: false }, { uri: "https://evil.example/x", duration: 30 }, { uri: "https://api.calendly.com/event_types/3", duration: 45 }] });
  assert.deepEqual(types, [{ uri: "https://api.calendly.com/event_types/1", minutes: 30 }, { uri: "https://api.calendly.com/event_types/3", minutes: 45 }]);
  assert.deepEqual(iso(calendlySlots({ collection: [{ status: "available", start_time: "2026-12-01T14:00:00.000000Z" }, { status: "unavailable", start_time: "2026-12-01T15:00:00Z" }, { status: "available" }] }, 30)), ["2026-12-01T14:00:00Z 2026-12-01T14:30:00Z"]);
  assert.deepEqual(calendlySlots({ message: "nope" }, 30), []);
});

test("a half hour is free only when all of it is; busy when any of it is", () => {
  const stretch = [[ms("2026-12-01T14:00:00Z"), ms("2026-12-01T15:00:00Z")]] as const;
  const half = 30 * 60_000;
  assert.equal(insideFree(stretch, ms("2026-12-01T14:30:00Z"), half), true);
  assert.equal(insideFree(stretch, ms("2026-12-01T14:45:00Z"), half), false);
  assert.equal(touchesBusy(stretch, ms("2026-12-01T14:45:00Z"), half), true);
  assert.equal(touchesBusy(stretch, ms("2026-12-01T15:00:00Z"), half), false);
});
