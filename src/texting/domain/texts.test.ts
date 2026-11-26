import assert from "node:assert/strict";
import { test } from "node:test";
import { callReminderText, invoiceReminderText, showPhone, usPhone } from "./texts.ts";

test("reads US numbers however they're written", () => {
  for (const raw of ["304-555-0142", "(304) 555-0142", "1 304 555 0142", "+1 304.555.0142"]) assert.deepEqual(usPhone(raw), { ok: true, value: "+13045550142" });
  for (const raw of ["555-0142", "104-555-0142", "304-155-0142", "+44 20 7946 0958", ""]) assert.equal(usPhone(raw).ok, false, raw);
  assert.equal(showPhone("+13045550142"), "(304) 555-0142");
});

test("texts say who they're from and how to stop, and stay short", () => {
  const call = callReminderText({ when: "tomorrow at 2:00 PM", phone: "304-555-0100" });
  assert.match(call, /^Potomac Solutions: .*tomorrow at 2:00 PM.*Reply STOP to stop texts\.$/);
  const bill = invoiceReminderText({ label: "INV-0012", owed: "$900.00", due: "last Friday", overdue: true, portalUrl: "https://hq.potomac.solutions/portal" });
  assert.match(bill, /INV-0012 for \$900\.00 was due last Friday\. Pay or see it at https:\/\/hq\.potomac\.solutions\/portal Reply STOP/);
  for (const text of [call, bill]) assert.ok(text.length <= 320, `${text.length}`);
});
