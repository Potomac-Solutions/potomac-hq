// Domain rules for the billing extras (decision 0017, third part).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { howToPay, receiptEmail, statementEmail } from "./client-mail.ts";
import { newInvoice, promisePayment, sendInvoice, setPayLink, writeOff } from "./invoice.ts";
import { newBlock, prepaidBalance } from "./prepaid.ts";

const id = (n: number) => `0190a000-0000-7000-8000-00000000000${n}` as Id;
const draft = () => {
  const made = newInvoice({ id: id(1), organizationId: id(2), projectId: null, number: 4, createdBy: id(3) }, { kind: "other", description: "Domain", amount: "25" });
  assert.ok(made.ok);
  return made.value;
};
const sent = () => {
  const out = sendInvoice(draft(), "2026-11-25");
  assert.ok(out.ok);
  return out.value;
};

test("a promise to pay is only on a sent invoice; an empty day clears it", () => {
  assert.deepEqual(promisePayment(draft(), { on: "2026-11-27" }), { ok: false, error: "not-sent" });
  const promised = promisePayment(sent(), { on: "2026-11-27", note: "Friday" });
  assert.ok(promised.ok);
  assert.deepEqual([promised.value.promisedOn, promised.value.promiseNote], ["2026-11-27", "Friday"]);
  const cleared = promisePayment(promised.value, { on: " " });
  assert.ok(cleared.ok);
  assert.deepEqual([cleared.value.promisedOn, cleared.value.promiseNote], [null, ""]);
  assert.deepEqual(promisePayment(sent(), { on: "Friday" }), { ok: false, error: "invalid-date" });
});

test("a card payment link is https only, with no sign-in in it", () => {
  assert.equal(setPayLink(sent(), " https://pay.example/x ").ok && setPayLink(sent(), "https://pay.example/x").ok, true);
  assert.deepEqual(setPayLink(sent(), "http://pay.example/x"), { ok: false, error: "link-not-https" });
  assert.deepEqual(setPayLink(sent(), "javascript:alert(1)"), { ok: false, error: "link-not-https" });
  assert.deepEqual(setPayLink(sent(), "https://user:pw@pay.example/x"), { ok: false, error: "link-not-https" });
  const cleared = setPayLink(sent(), "");
  assert.ok(cleared.ok);
  assert.equal(cleared.value.payLink, null);
});

test("a write-off voids a sent invoice with a reason, apart from a mistake", () => {
  assert.deepEqual(writeOff(draft(), { note: "x" }, "2026-11-25"), { ok: false, error: "not-sent" });
  assert.deepEqual(writeOff(sent(), { note: " " }, "2026-11-25"), { ok: false, error: "write-off-note-missing" });
  const done = writeOff(sent(), { note: "Closed" }, "2026-11-25");
  assert.ok(done.ok);
  assert.deepEqual([done.value.status, done.value.writtenOffOn, done.value.writtenOffNote], ["void", "2026-11-25", "Closed"]);
});

test("prepaid hours: quarter hours, and low at a fifth left or two hours", () => {
  const block = newBlock({ id: id(1), organizationId: id(2), createdBy: id(3), invoiceId: null }, { hours: "10", boughtOn: "2026-11-01" });
  assert.ok(block.ok);
  assert.equal(block.value.minutes, 600);
  assert.deepEqual(newBlock({ id: id(1), organizationId: id(2), createdBy: id(3), invoiceId: null }, { hours: "0", boughtOn: "2026-11-01" }), { ok: false, error: "invalid-hours" });
  assert.deepEqual(newBlock({ id: id(1), organizationId: id(2), createdBy: id(3), invoiceId: null }, { hours: "ten", boughtOn: "2026-11-01" }), { ok: false, error: "invalid-hours" });
  assert.equal(prepaidBalance([block.value], 300).low, false);
  assert.equal(prepaidBalance([block.value], 480).low, true, "two hours left");
  assert.deepEqual(prepaidBalance([block.value], 700), { boughtMinutes: 600, usedMinutes: 700, leftMinutes: -100, low: true, since: "2026-11-01" });
  assert.equal(prepaidBalance([], 50).low, false);
});

test("receipts and statements say how to pay in Potomac's words when set", () => {
  assert.deepEqual(howToPay({ instructions: "Zelle to pay@potomac.solutions", address: "" }), ["How to pay:", "Zelle to pay@potomac.solutions"]);
  assert.deepEqual(howToPay({ instructions: "", label: "INV-0004", address: "1 River Rd" }), ["How to pay: a check made out to Potomac Solutions, or cash. Write INV-0004 on the check.", "Mail it to: 1 River Rd"]);
  const receipt = receiptEmail({ name: "Stacy Roberts", businessName: "Better Days", label: "INV-0004", amount: "$25.00", on: "Wed, Nov 25", method: "Check", stillOwed: "", portalUrl: null, phone: "" });
  assert.equal(receipt.subject, "Receipt for INV-0004: $25.00");
  assert.match(receipt.body, /^Hi Stacy,\n\nThank you: we received \$25\.00 for invoice INV-0004 on Wed, Nov 25, by check\.\n\nINV-0004 is paid in full\./);
  const statement = statementEmail({ name: "Dana", businessName: "Better Days", month: "December 2026", invoices: [{ label: "INV-0004", forWhat: "Domain", owed: "$25.00", due: "Wed, Dec 2", overdue: false }], total: "$25.00", instructions: "", address: "", portalUrl: null, phone: "" });
  assert.equal(statement.subject, "Your statement for December 2026: $25.00 owed");
  assert.match(statement.body, /- INV-0004, Domain: \$25\.00, due Wed, Dec 2/);
});
