// Filling availability in from somewhere else, over real HTTP, with the
// outside world stood in for: a calendar's private address, a Timeful event
// and Calendly. Potomac links a calendar and paints from Timeful and
// Calendly; a client fills in an invite from each.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { OutsideFetch } from "../../src/booking/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, clientSignedIn, signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

const NY = "America/New_York";
let t: TestApp;
let admin: Client;
let member: Client;
let rita: Client;
let bob: Client;
let invite: string;
const where = (res: Response) => res.headers.get("location") ?? "";
const problemOf = (res: Response) => new URL(t.origin + where(res)).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + where(res)).searchParams.get("done") ?? "";
const monday = (() => {
  const today = Temporal.Now.plainDateISO(NY);
  return today.add({ days: 8 - today.dayOfWeek });
})();
const tuesday = monday.add({ days: 1 });
const at = (day: Temporal.PlainDate, clock: string) => Temporal.PlainDateTime.from(`${day}T${clock}`).toZonedDateTime(NY).toInstant();
const stamp = (instant: Temporal.Instant) => instant.toString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const cells = () => t.db.prepare("select start from schedule_invite_cell order by start").all().map((row) => String(row["start"]));

// The outside world: what each address answers, and what was asked.
const world = new Map<string, { status: number; text: string }>();
const asked: { url: string; authorization: string }[] = [];
const outsideFetch: OutsideFetch = async (url, headers = {}) => {
  asked.push({ url, authorization: headers["authorization"] ?? "" });
  if (url.includes("10.0.0.5")) return { ok: false, error: "address-private" };
  const exact = world.get(url) ?? [...world].find(([key]) => url.startsWith(key))?.[1];
  return exact ? { ok: true, value: exact } : { ok: false, error: "unreachable" };
};
const calendar = (...events: [Temporal.Instant, Temporal.Instant][]) => ["BEGIN:VCALENDAR", ...events.flatMap(([from, to]) => ["BEGIN:VEVENT", "SUMMARY:Dentist, 12 Elm St", `DTSTART:${stamp(from)}`, `DTEND:${stamp(to)}`, "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");
const MINE = "https://calendar.example/private-abc123/basic.ics";

before(async () => {
  t = await testApp({ outsideFetch });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  member = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await admin.get("/");
  await member.get("/");
  // Free weekdays 9:00 to 11:00.
  await admin.post("/calls/hours/week", Object.fromEntries([1, 2, 3, 4, 5].flatMap((d) => [540, 570, 600, 630].map((m) => [`c-${d}-${m}`, "1"]))));
  const me = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const clientId = unwrap(crm.createClient(t.services.crm, me, { name: "Elk Diner", sizeTier: "small" })).id;
  rita = await clientSignedIn(t, admin, clientId, "Rita Okafor", "rita@example.com");
  const ritaId = t.db.prepare("select id from client_user where email = 'rita@example.com'").get()?.["id"] as string;
  bob = await clientSignedIn(t, admin, unwrap(crm.createClient(t.services.crm, me, { name: "Gormania Feed", sizeTier: "small" })).id, "Bob Miller", "bob@feed.example");
  await admin.post("/invites", { clientUserId: ritaId, organizationId: clientId, title: "Kickoff call", minutes: "30", firstDay: monday.toString(), lastDay: tuesday.toString() });
  invite = t.db.prepare("select id from schedule_invite").get()?.["id"] as string;
});
beforeEach(() => {
  asked.length = 0;
  t.db.exec("delete from rate_limit where name = 'availability-import'");
});
after(() => t.stop());

test("Potomac links a calendar: a wrong address is refused, and the right one is never shown again", async () => {
  assert.match(textOf(await admin.page("/calls/hours")), /Your calendars Link a calendar and its busy times are never offered for calls/);
  assert.match(problemOf(await member.post("/calls/calendar-links", { link: MINE })), /permission/);
  assert.match(problemOf(await admin.post("/calls/calendar-links", { link: "http://calendar.example/a.ics" })), /private address: a link starting with https/);
  assert.match(problemOf(await admin.post("/calls/calendar-links", { link: "https://10.0.0.5/a.ics" })), /isn’t on the public internet/);
  assert.match(problemOf(await admin.post("/calls/calendar-links", { link: MINE })), /couldn’t be reached/);
  world.set(MINE, { status: 200, text: "<html>Sign in to continue</html>" });
  assert.match(problemOf(await admin.post("/calls/calendar-links", { link: MINE })), /opened a web page, not a calendar/);
  world.set(MINE, { status: 404, text: "" });
  assert.match(problemOf(await admin.post("/calls/calendar-links", { link: MINE })), /refused that address/);
  assert.equal(t.db.prepare("select count(*) as n from calendar_link").get()?.["n"], 0);

  // Busy Monday 9:00 to 10:00.
  world.set(MINE, { status: 200, text: calendar([at(monday, "09:00"), at(monday, "10:00")]) });
  assert.equal(doneOf(await admin.post("/calls/calendar-links", { label: " Personal ", link: MINE.replace("https://", "webcal://") })), "Linked. Its busy times are no longer offered for calls.");
  assert.equal(problemOf(await admin.post("/calls/calendar-links", { link: MINE })), "That calendar is already linked.");
  const page = await admin.page("/calls/hours");
  assert.match(textOf(page), /Personal calendar\.example Reading Remove/);
  assert.ok(!page.includes("private-abc123"), "the address is never shown");
  assert.equal(actions(t.db).at(-1), "booking.calendar-linked");
  assert.ok(!JSON.stringify(t.db.prepare("select context from activity_event order by rowid desc limit 1").get()).includes("private-abc123"), "nor written to the activity log");
  assert.match(textOf(page), /Open times also avoid busy times in your linked calendars\./);
});

test("the linked calendar's busy times are not offered to anyone, and show on the week's grid", async () => {
  const html = await (await rita.get(`/portal/invites/${invite}`)).text();
  assert.match(html, new RegExp(`name="c-${monday}-540" value="1"[^>]*disabled`), "Monday 9:00 is busy in the calendar");
  assert.match(html, new RegExp(`name="c-${monday}-600" value="1"(?![^>]*disabled)`), "10:00 is open");
  const grid = await admin.page(`/calls/availability?week=${monday}`);
  assert.match(grid, new RegExp(`class="cell busy"[^>]*name="c-${monday}-540"|name="c-${monday}-540"[^>]*class="cell busy"`));
  assert.ok(!grid.includes("Dentist"), "what the events are is never read out");
});

test("a client fills in an invite from their own calendar: every open time they aren't busy", async () => {
  const hers = "https://outlook.example/owa/calendar/rita/reachcalendar.ics";
  // Rita is busy Monday 10:00 to 10:30 and all of Tuesday morning but 10:30.
  world.set(hers, { status: 200, text: calendar([at(monday, "10:00"), at(monday, "10:30")], [at(tuesday, "08:00"), at(tuesday, "10:30")]) });
  assert.match(textOf(await rita.page(`/portal/invites/${invite}`)), /Or fill it in for me .* Your calendar Google, Outlook or Apple .* Timeful .* Calendly/);
  assert.equal(problemOf(await bob.post(`/portal/invites/${invite}/fill`, { source: "calendar", link: hers })), "That doesn’t exist any more.");
  assert.equal(problemOf(await rita.post(`/portal/invites/${invite}/fill`, { source: "fax", link: hers })), "Choose where to fill in from.");
  const filled = await rita.post(`/portal/invites/${invite}/fill`, { source: "calendar", link: hers });
  assert.equal(doneOf(filled), "Filled in. These are saved: check them below and change any that are off.");
  assert.equal(where(filled).split("?")[0], `/portal/invites/${invite}`);
  // Open to her: Monday 10:00, 10:30 (9:00 to 10:00 is Potomac's busy time); Tuesday 9:00 to 11:00.
  assert.deepEqual(cells(), [at(monday, "10:30"), at(tuesday, "10:30")].map(String));
  assert.equal(t.db.prepare("select count(*) as n from calendar_link").get()?.["n"], 1, "her address isn't kept");
  const event = t.db.prepare("select action, context from activity_event order by rowid desc limit 1").get();
  assert.equal(event?.["action"], "schedule-invite.answered");
  assert.equal(JSON.parse(String(event?.["context"])).from, "calendar");
  assert.ok(!String(event?.["context"]).includes("outlook.example"));

  // A calendar that leaves nothing changes nothing.
  world.set(hers, { status: 200, text: calendar([at(monday, "00:00"), at(tuesday, "23:00")]) });
  assert.match(problemOf(await rita.post(`/portal/invites/${invite}/fill`, { source: "calendar", link: hers })), /nothing was changed/);
  assert.equal(cells().length, 2);
});

const EVENT = "65f0c0ffee65f0c0ffee65f0";
const timeful = (people: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ status: 200, text: JSON.stringify({ _id: EVENT, shortId: "fqQrJT", name: "Kickoff", type: "specific_dates", timeIncrement: 15, dates: [at(monday, "09:00").toString(), at(tuesday, "09:00").toString()], responses: people, ...extra }) });
const quarters = (day: Temporal.PlainDate, from: string, count: number) => Array.from({ length: count }, (_, n) => at(day, from).add({ minutes: 15 * n }).toString());

test("a client fills in an invite from a Timeful event: the times they marked there", async () => {
  const link = "https://timeful.app/e/fqQrJT";
  assert.match(problemOf(await rita.post(`/portal/invites/${invite}/fill`, { source: "timeful", link: "https://evil.example/e/fqQrJT" })), /Paste the event’s link/);
  assert.equal(asked.length, 0, "nothing but timeful.app is ever asked");
  world.set("https://timeful.app/api/events/fqQrJT", { status: 404, text: '{"error":"event-not-found"}' });
  assert.equal(problemOf(await rita.post(`/portal/invites/${invite}/fill`, { source: "timeful", link })), "Timeful has no event at that link.");

  world.set("https://timeful.app/api/events/fqQrJT", timeful({ u1: { user: { firstName: "Rita", lastName: "Okafor" } }, "Bo Diaz": { name: "Bo Diaz" } }));
  // Rita marked Monday 10:00 to 10:45 (three quarters: one whole half hour) and Tuesday 9:00 to 10:00.
  world.set(`https://timeful.app/api/events/${EVENT}/responses`, { status: 200, text: JSON.stringify({ u1: { availability: [...quarters(monday, "10:00", 3), ...quarters(tuesday, "09:00", 4)] }, "Bo Diaz": { availability: quarters(monday, "10:30", 2) } }) });
  assert.equal(problemOf(await rita.post(`/portal/invites/${invite}/fill`, { source: "timeful", link })), "Which name on that event is yours? It has answers from Rita Okafor, Bo Diaz.");
  assert.equal(doneOf(await rita.post(`/portal/invites/${invite}/fill`, { source: "timeful", link, name: "rita" })).slice(0, 10), "Filled in.");
  assert.deepEqual(cells(), [at(monday, "10:00"), at(tuesday, "09:00"), at(tuesday, "09:30")].map(String));
  assert.match(asked.at(-1)?.url ?? "", /\/responses\?timeMin=.*&timeMax=/);

  world.set("https://timeful.app/api/events/fqQrJT", timeful({ u1: { user: { firstName: "Rita" } } }, { daysOnly: true }));
  assert.match(problemOf(await rita.post(`/portal/invites/${invite}/fill`, { source: "timeful", link })), /only asks about days/);
  world.set("https://timeful.app/api/events/fqQrJT", { status: 200, text: "<!doctype html>" });
  assert.match(problemOf(await rita.post(`/portal/invites/${invite}/fill`, { source: "timeful", link })), /may have changed how it works/);
});

const TOKEN = "eyJraWQiOiIxY2UxZTEzNjE3ZGNmNzY2YjNjZWJjY2Y4ZGM1YmFmYThhNjVlNjg0MDIzZjdjMzJiZTgzNDliMjM4MDEzNWI0";
function calendly(slots: Temporal.Instant[]) {
  world.set("https://api.calendly.com/users/me", { status: 200, text: JSON.stringify({ resource: { uri: "https://api.calendly.com/users/AAA" } }) });
  world.set("https://api.calendly.com/event_types?", { status: 200, text: JSON.stringify({ collection: [{ uri: "https://api.calendly.com/event_types/T1", duration: 30, active: true }] }) });
  world.set("https://api.calendly.com/event_type_available_times?", { status: 200, text: JSON.stringify({ collection: slots.map((start) => ({ status: "available", start_time: start.toString() })) }) });
}

test("a client fills in an invite from Calendly, with a token that is used once and never kept", async () => {
  assert.match(problemOf(await rita.post(`/portal/invites/${invite}/fill`, { source: "calendly", token: "short" })), /personal access token/);
  world.set("https://api.calendly.com/users/me", { status: 401, text: '{"title":"Unauthenticated"}' });
  assert.match(problemOf(await rita.post(`/portal/invites/${invite}/fill`, { source: "calendly", token: TOKEN })), /refused that token/);
  calendly([at(tuesday, "10:00"), at(tuesday, "10:30"), at(tuesday, "15:00")]);
  assert.equal(doneOf(await rita.post(`/portal/invites/${invite}/fill`, { source: "calendly", token: TOKEN })).slice(0, 10), "Filled in.");
  assert.deepEqual(cells(), [at(tuesday, "10:00"), at(tuesday, "10:30")].map(String));
  assert.ok(asked.every((one) => one.url.startsWith("https://api.calendly.com/") && one.authorization === `Bearer ${TOKEN}`));
  const everything = JSON.stringify([t.db.prepare("select context from activity_event").all(), t.db.prepare("select * from refused_attempt").all()]);
  assert.ok(!everything.includes(TOKEN), "the token is in no log");
});

test("Potomac paints the next two weeks from Calendly; a member can't; a calendar isn't painted from", async () => {
  assert.match(textOf(await admin.page("/calls/availability")), /Fill in from somewhere else .* Timeful .* Calendly/);
  assert.ok(!textOf(await admin.page("/calls/availability")).includes("Google, Outlook or Apple"), "a calendar is linked, not painted from");
  assert.match(problemOf(await member.post("/calls/availability/fill", { source: "calendly", token: TOKEN })), /permission/);
  assert.equal(problemOf(await admin.post("/calls/availability/fill", { source: "calendar", link: MINE })), "Choose where to fill in from.");
  // Calendly says: Monday 13:00 to 14:00 only, and nothing else in two weeks.
  calendly([at(monday, "13:00"), at(monday, "13:30")]);
  assert.match(doneOf(await admin.post("/calls/availability/fill", { source: "calendly", token: TOKEN })), /Filled in the next two weeks/);
  const painted = Object.fromEntries(t.db.prepare("select day, start, end from booking_date_hours order by day, start").all().map((row) => [String(row["day"]), `${row["start"]}-${row["end"]}`]));
  assert.equal(painted[monday.toString()], "780-840");
  const event = t.db.prepare("select action, context from activity_event order by rowid desc limit 1").get();
  assert.equal(event?.["action"], "booking.dates-painted");
  assert.equal(JSON.parse(String(event?.["context"])).from, "calendly");
  // Every other weekday in the two weeks now has no calls.
  assert.ok(Number(t.db.prepare("select count(*) as n from booking_date").get()?.["n"]) >= 9, "the other weekdays are painted with nothing free");

  // Nothing free anywhere is taken for a mistake.
  calendly([]);
  assert.match(problemOf(await admin.post("/calls/availability/fill", { source: "calendly", token: TOKEN })), /nothing was changed/);
});

test("Potomac paints from a Timeful event: only the days it asks about", async () => {
  world.set("https://timeful.app/api/events/fqQrJT", timeful({ u1: { user: { firstName: "Mikey", lastName: "Nichols" } } }));
  world.set(`https://timeful.app/api/events/${EVENT}/responses`, { status: 200, text: JSON.stringify({ u1: { availability: quarters(tuesday, "15:00", 4) } }) });
  const before = t.db.prepare("select count(*) as n from booking_date where day > ?").get(tuesday.toString())?.["n"];
  assert.match(doneOf(await admin.post("/calls/availability/fill", { source: "timeful", link: "https://timeful.app/e/fqQrJT" })), /Filled in/);
  const ranges = (day: Temporal.PlainDate) => t.db.prepare("select start, end from booking_date_hours where day = ? order by start").all(day.toString()).map((row) => `${row["start"]}-${row["end"]}`);
  assert.deepEqual(ranges(tuesday), ["900-960"]);
  assert.deepEqual(ranges(monday), [], "Monday is on the event, with nothing marked: no calls");
  assert.equal(t.db.prepare("select count(*) as n from booking_date where day > ?").get(tuesday.toString())?.["n"], before, "days the event doesn't ask about are left alone");
});

test("ten fills an hour for each person; removing a link forgets its address", async () => {
  for (let n = 0; n < 10; n += 1) await rita.post(`/portal/invites/${invite}/fill`, { source: "calendly", token: "short" });
  assert.match(problemOf(await rita.post(`/portal/invites/${invite}/fill`, { source: "calendly", token: "short" })), /ten tries in an hour/);
  const id = t.db.prepare("select id from calendar_link").get()?.["id"] as string;
  assert.match(problemOf(await member.post(`/calls/calendar-links/${id}/remove`, {})), /permission/);
  assert.equal(doneOf(await admin.post(`/calls/calendar-links/${id}/remove`, {})), "Removed. HQ has forgotten its address.");
  assert.equal(t.db.prepare("select count(*) as n from calendar_link").get()?.["n"], 0);
  assert.equal(actions(t.db).at(-1), "booking.calendar-unlinked");
});
