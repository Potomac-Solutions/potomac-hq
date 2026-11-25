import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanNote, composeReport, lastMonth, monthBounds, monthLabel, reportEmail, upText, type MonthFacts } from "./report.ts";

const ZONE = "America/New_York";
const quiet: MonthFacts = { sites: [], tasksDone: 0, milestonesDone: [], sitePublishes: 0, changesApproved: [], comingUp: [], invoicesToPay: 0, approvalsWaiting: 0 };

test("the month before, and its bounds in Potomac's time zone", () => {
  assert.equal(lastMonth("2026-12-01"), "2026-11");
  assert.equal(lastMonth("2027-01-03"), "2026-12");
  assert.deepEqual(monthBounds("2026-11", ZONE), { from: "2026-11-01T04:00:00Z", to: "2026-12-01T05:00:00Z" });
  assert.equal(monthLabel("2026-11"), "November 2026");
});

test("uptime reads as a person would say it", () => {
  const { from, to } = monthBounds("2026-11", ZONE);
  assert.equal(upText({ host: "moats.com", outages: [] }, from, to), "moats.com was up the whole month.");
  assert.equal(upText({ host: "moats.com", outages: [{ start: "2026-11-10T10:00:00Z", end: "2026-11-10T10:45:00Z" }] }, from, to), "moats.com was up 99.90% of the month (down 45 minutes in all).");
  assert.equal(upText({ host: "moats.com", outages: [{ start: "2026-10-31T20:00:00Z", end: "2026-11-01T07:00:00Z" }] }, from, to), "moats.com was up 99.58% of the month (down 3 hours in all).", "an outage from before the month counts only its part");
});

test("a busy month has each section; a quiet one says so", () => {
  const body = composeReport({ clientName: "Moats Hardware", month: "2026-11", zone: ZONE, facts: { sites: [{ host: "moats.com", outages: [] }], tasksDone: 7, milestonesDone: ["Holiday hours page"], sitePublishes: 2, changesApproved: ["New gallery"], comingUp: [{ what: "moats.com renews", on: "2026-12-14" }], invoicesToPay: 1, approvalsWaiting: 0 } });
  assert.equal(body, "Here’s Moats Hardware’s month with Potomac Solutions: November 2026.\n\nYour website\n- moats.com was up the whole month.\n\nWhat we did\n- Finished: Holiday hours page\n- Put 2 updates live on your website\n- Your change: New gallery\n- 7 tasks done in all\n\nComing up\n- moats.com renews, December 14\n\nWaiting on you\n- 1 invoice to pay");
  assert.match(composeReport({ clientName: "Moats Hardware", month: "2026-11", zone: ZONE, facts: quiet }), /A quiet month: everything ran as it should\.$/);
});

test("the email greets the contact by first name and carries Potomac's own line first", () => {
  const mail = reportEmail({ body: "Report", note: "Thanks for the referral!", month: "2026-11" }, { name: "Rita Moats" }, "Reply to this email, or call 240-321-9997.");
  assert.equal(mail.subject, "Your month with Potomac Solutions: November 2026");
  assert.equal(mail.body, "Hi Rita,\n\nThanks for the referral!\n\nReport\n\nQuestions about any of it? Reply to this email, or call 240-321-9997.\n\nMikey and Jayanti\nPotomac Solutions");
  assert.deepEqual(cleanNote("x".repeat(1001)), { ok: false, error: "note-too-long" });
  assert.deepEqual(cleanNote("  "), { ok: true, value: "" });
});
