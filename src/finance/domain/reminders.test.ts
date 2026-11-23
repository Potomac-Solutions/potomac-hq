import assert from "node:assert/strict";
import { test } from "node:test";
import { reminderDue, reminderEmail } from "./reminders.ts";

const sent = { status: "sent", dueOn: "2026-12-04", owedMinor: 4900 };

test("each step comes once, and only the latest that has come is sent", () => {
  assert.equal(reminderDue(sent, "2026-11-30", []), null, "four days before");
  assert.equal(reminderDue(sent, "2026-12-01", []), "soon");
  assert.equal(reminderDue(sent, "2026-12-03", ["soon"]), null);
  assert.equal(reminderDue(sent, "2026-12-04", ["soon"]), null, "not on the day itself");
  assert.equal(reminderDue(sent, "2026-12-05", ["soon"]), "due");
  assert.equal(reminderDue(sent, "2026-12-11", ["soon", "due"]), "late-7");
  assert.equal(reminderDue(sent, "2026-12-18", ["soon", "due", "late-7"]), "late-14");
  assert.equal(reminderDue(sent, "2027-02-01", ["soon", "due", "late-7", "late-14"]), null, "then it is a phone call");
  assert.equal(reminderDue(sent, "2026-12-20", []), "late-14", "found two weeks late: only the last step");
});

test("paid, drafts, void and invoices with no due day get none", () => {
  assert.equal(reminderDue({ ...sent, owedMinor: 0 }, "2026-12-05", []), null);
  assert.equal(reminderDue({ ...sent, status: "paid" }, "2026-12-05", []), null);
  assert.equal(reminderDue({ ...sent, status: "draft" }, "2026-12-05", []), null);
  assert.equal(reminderDue({ ...sent, dueOn: null }, "2026-12-05", []), null);
});

test("the email says what is owed, how to pay, and gets firmer but stays kind", () => {
  const mail = reminderEmail({ kind: "due", name: "Bob Miller", businessName: "Gormania Feed", label: "INV-0007", owed: "$49.00", due: "Fri, Dec 4", projectName: "Feed store website", portalUrl: "https://hq.example/portal", phone: "304-555-0142", address: "PO Box 12, Gormania, WV 26720" });
  assert.equal(mail.subject, "INV-0007 was due Fri, Dec 4");
  assert.match(mail.body, /^Hi Bob,\n\nInvoice INV-0007 for Feed store website, \$49\.00, was due Fri, Dec 4\. If it's already on its way, thank you/);
  assert.match(mail.body, /Write INV-0007 on the check\.\nMail it to: PO Box 12, Gormania, WV 26720/);
  assert.match(mail.body, /See the invoice and download it: https:\/\/hq\.example\/portal/);
  assert.match(reminderEmail({ ...{ kind: "late-14" as const, name: "Bob", businessName: "", label: "INV-0007", owed: "$49.00", due: "", projectName: "x", portalUrl: null, phone: "", address: "" } }).body, /Please call us so we can sort it out together\./);
});
