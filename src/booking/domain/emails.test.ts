import assert from "node:assert/strict";
import { test } from "node:test";
import type { Booking } from "./booking.ts";
import { bookerEmail, hostEmail } from "./emails.ts";
import type { Id } from "../../shared/domain/id.ts";

const booking: Booking = {
  id: "11111111-1111-4111-8111-111111111111" as Id,
  kind: "public",
  status: "booked",
  start: "2026-11-24T14:00:00Z",
  end: "2026-11-24T14:30:00Z",
  name: "Dale Pruitt",
  email: "dale@example.com",
  phone: "304-555-0134",
  topic: "A website for the farm stand",
  organizationId: null,
  clientUserId: null,
  hostId: "22222222-2222-4222-8222-222222222222" as Id,
  createdAt: "2026-11-22T17:00:00Z",
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: "",
};
const when = "Tue, Nov 24, 9:00 AM to 9:30 AM";

test("the person who booked from the page gets the time, the topic, and the private link to keep", () => {
  const mail = bookerEmail({ booking, event: "made", when, manageUrl: "https://hq.example/book/manage?token=abc", phone: "304-555-0142" });
  assert.equal(mail.to, "dale@example.com");
  assert.equal(mail.subject, `Your call with Potomac Solutions: ${when}`);
  assert.equal(mail.body, ["Hi Dale,", "", "You're booked for a call with Potomac Solutions:", "", `${when}, Eastern time`, "", "About: A website for the farm stand", "", "Add it to your calendar, move it or cancel it here:\nhttps://hq.example/book/manage?token=abc", "", "Keep this email: that link is the way to change your booking.", "", "Need us sooner? Call 304-555-0142.", "", "Potomac Solutions"].join("\n"));
});

test("a cancel says who cancelled and why; a reminder from the page points to the first email", () => {
  const byUs = bookerEmail({ booking: { ...booking, status: "cancelled", cancelledBy: "staff", cancelReason: "Snowed in" }, event: "cancelled", when, manageUrl: "https://hq.example/book", phone: "" });
  assert.match(byUs.body, /Potomac Solutions had to cancel your call on Tue, Nov 24, 9:00 AM to 9:30 AM\.\n\n"Snowed in"/);
  assert.match(byUs.body, /Book another time here:\nhttps:\/\/hq\.example\/book/);
  const byThem = bookerEmail({ booking: { ...booking, status: "cancelled", cancelledBy: "booker" }, event: "cancelled", when, manageUrl: null, phone: "" });
  assert.match(byThem.body, /is cancelled, as you asked\./);
  const reminder = bookerEmail({ booking, event: "reminder", when, manageUrl: null, phone: "" });
  assert.equal(reminder.subject, `Tomorrow: your call with Potomac Solutions, ${when}`);
  assert.match(reminder.body, /use the link in the email you got when you booked/);
});

test("the host hears who booked, moved or cancelled, how to reach them, and where the calls are", () => {
  const made = hostEmail({ booking, event: "made", when, was: "", hostEmail: "mikey@example.com", callsUrl: "https://hq.example/calls" });
  assert.equal(made.to, "mikey@example.com");
  assert.equal(made.subject, `Call booked: Dale Pruitt, ${when}`);
  assert.match(made.body, /^Dale Pruitt \(from the booking page\) booked a call\.\n\nTue, Nov 24, 9:00 AM to 9:30 AM, Eastern time\ndale@example\.com · 304-555-0134\n\nAbout: A website for the farm stand\n\nAll calls: https:\/\/hq\.example\/calls$/);
  const moved = hostEmail({ booking: { ...booking, kind: "client" }, event: "moved", when, was: "Mon, Nov 23, 9:00 AM to 9:30 AM", hostEmail: "m@example.com", callsUrl: "x" });
  assert.match(moved.body, /^Dale Pruitt \(client\) moved their call from Mon, Nov 23, 9:00 AM to 9:30 AM\./);
  const cancelled = hostEmail({ booking: { ...booking, status: "cancelled", cancelReason: "Hired someone local" }, event: "cancelled", when, was: "", hostEmail: "m@example.com", callsUrl: "x" });
  assert.match(cancelled.body, /Why: Hired someone local/);
});
