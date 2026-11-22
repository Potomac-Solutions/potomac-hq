// Booking, HQ's side, over real HTTP: setting the hours, days off, the calls
// list, cancelling, and a call's calendar file.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { bookCall, openTimes } from "../../src/booking/index.ts";
import { createServices } from "../../src/services.ts";
import { actions, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";

// Every day, all day: an open time always exists, whatever the clock says.
const allWeek = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].flatMap((day) => [[`start-${day}-0`, "00:00"], [`end-${day}-0`, "23:00"]]));
const setup = { ...allWeek, "call-minutes": "60", "gap-minutes": "0", "notice-hours": "1", "days-ahead": "14", "public-open": "1" };

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
  await member.get("/");
});
after(() => t.stop());

test("until hours are set nobody can book, and the hours page says so", async () => {
  assert.match(textOf(await admin.page("/calls")), /No hours are set, so nobody can book a call yet\. Hours and days off/);
  const view = await openTimes(createServices(t.db).booking, "public");
  assert.equal(view.open, false);
  assert.equal((await member.get("/calls/hours")).status, 403, "a member sees calls, not the hours");
  assert.equal((await member.get("/calls")).status, 200);
});

test("hours are checked, saved, and make open times", async () => {
  assert.equal(problemOf(await admin.post("/calls/hours", { ...setup, "start-1-0": "9am" })), "Enter times like 09:00 or 17:30.");
  assert.equal(problemOf(await admin.post("/calls/hours", { ...setup, "call-minutes": "25" })), "Choose a call length from the list.");
  assert.equal(problemOf(await admin.post("/calls/hours", { ...setup, "start-1-1": "10:00", "end-1-1": "12:00" })), "Two stretches on the same day overlap.");
  assert.equal(problemOf(await member.post("/calls/hours", setup)), "You don’t have permission to do that.");

  assert.equal(doneOf(await admin.post("/calls/hours", setup)), "Saved. The open times have changed.");
  const page = textOf(await admin.page("/calls/hours"));
  assert.match(page, /Calls go on Mikey Nichols’s calendar/);
  assert.ok(actions(t.db).includes("booking.hours-changed"));

  const services = createServices(t.db).booking;
  const view = await openTimes(services, "public");
  assert.equal(view.open, true);
  assert.equal(view.callMinutes, 60);
  assert.ok(view.days.length >= 14, "two weeks of days");
  assert.equal((await openTimes(services, "portal")).open, false, "the portal is still off");
});

test("a day off takes its times away, and can be opened again", async () => {
  const services = createServices(t.db).booking;
  const before = await openTimes(services, "public");
  const day = before.days[2]?.day as string;
  assert.equal(doneOf(await admin.post("/calls/days-off", { day, note: "Farm show" })), "That day is closed to calls.");
  assert.ok(!(await openTimes(services, "public")).days.some((one) => one.day === day));
  assert.match(textOf(await admin.page("/calls/hours")), /Farm show/);
  assert.equal(problemOf(await admin.post("/calls/days-off", { day: "2026-02-30" })), "Enter a day like 2026-12-24.");
  assert.equal(doneOf(await admin.post("/calls/days-off/open", { day })), "That day is open again.");
  assert.ok((await openTimes(services, "public")).days.some((one) => one.day === day));
});

test("a booked call shows on Calls and the dashboard, takes its time, has a calendar file, and can be cancelled", async () => {
  const services = createServices(t.db).booking;
  const first = (await openTimes(services, "public")).days[1]?.slots[0];
  assert.ok(first);
  const made = await bookCall(services, { kind: "public", name: "Dale Pruitt", email: "dale@example.com", phone: "304-555-0134", topic: "A website for the farm" }, first.start);
  assert.ok(made.ok);
  assert.ok(made.value.manageToken, "a private link for the person who booked");
  assert.deepEqual(await bookCall(services, { kind: "public", name: "Someone Else", email: "else@example.com" }, first.start), { ok: false, error: "taken" }, "nobody else gets that time");
  assert.ok(!(await openTimes(services, "public")).days.flatMap((day) => day.slots).some((slot) => slot.start === first.start));

  const calls = textOf(await member.page("/calls"));
  assert.match(calls, /Coming up .* Dale Pruitt Booking page dale@example\.com · 304-555-0134 · Add to calendar A website for the farm/);
  assert.match(textOf(await admin.page("/")), /Next calls .* Dale Pruitt · A website for the farm/);

  const id = made.value.booking.id;
  const file = await admin.get(`/calls/${id}.ics`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "text/calendar; charset=utf-8");
  assert.match(await file.text(), /SUMMARY:Call with Potomac Solutions: Dale Pruitt/);

  assert.equal(doneOf(await member.post(`/calls/${id}/cancel`, { reason: "Snowed in" })), "Cancelled.");
  assert.match(textOf(await admin.page("/calls")), /Cancelled by Potomac: Snowed in/);
  assert.ok((await openTimes(services, "public")).days.flatMap((day) => day.slots).some((slot) => slot.start === first.start), "the time is open again");
  assert.equal(problemOf(await member.post(`/calls/${id}/cancel`, {})), "That call has already started, or was cancelled.");
  assert.ok(actions(t.db).includes("booking.made") && actions(t.db).includes("booking.cancelled"));
});

test("someone who booked from the page goes into the CRM in one step, as a prospect with a consult booked", async () => {
  const services = createServices(t.db).booking;
  const slot = (await openTimes(services, "public")).days[3]?.slots[0];
  assert.ok(slot);
  const made = await bookCall(services, { kind: "public", name: "Rita Okafor", email: "rita@example.com", phone: "304-555-0177", topic: "Online orders for the diner. Maybe a menu page too." }, slot.start);
  assert.ok(made.ok);
  const id = made.value.booking.id;
  assert.match(textOf(await admin.page("/calls")), /Add to the CRM Business name/);
  assert.equal(problemOf(await member.post(`/calls/${id}/crm`, { business: "Elk Diner" })), "", "a member may add clients too");
  const added = t.db.prepare("select crm_client_id, crm_opportunity_id from booking where id = ?").get(id) as { crm_client_id: string; crm_opportunity_id: string };
  assert.ok(added.crm_client_id);
  // Already in: a second try is refused, and the form is gone.
  assert.equal(problemOf(await admin.post(`/calls/${id}/crm`, { business: "Elk Diner" })), "That call is already in the CRM.");
  const calls = textOf(await admin.page("/calls"));
  assert.match(calls, /Rita Okafor .* In the CRM/);
  const opportunity = textOf(await admin.page(`/opportunities/${added.crm_opportunity_id}`));
  assert.match(opportunity, /First call: Online orders for the diner/);
  assert.match(opportunity, /Consult booked/);
  assert.match(textOf(await admin.page(`/clients/${added.crm_client_id}`)), /Elk Diner .* Rita Okafor .* rita@example\.com/);
  assert.ok(actions(t.db).includes("booking.added-to-crm"));
});
