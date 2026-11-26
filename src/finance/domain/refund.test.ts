import assert from "node:assert/strict";
import { test } from "node:test";
import { refundPayment, type Invoice, type Payment } from "./invoice.ts";

test("a refund: part or all of one payment, a paid invoice owed again, never more than was paid", () => {
  const invoice = { id: "i1", status: "paid", total: { minor: 10000, currency: "USD" } } as never as Invoice;
  const payment = { id: "p1", invoiceId: "i1", amount: { minor: 10000, currency: "USD" }, method: "check", receivedOn: "2026-11-20", reference: "", recordedBy: "u1" } as never as Payment;
  const ids = { id: "r1" as never, recordedBy: "u1" as never };
  const part = refundPayment(invoice, payment, 0, ids, { amount: "25", on: "2026-11-25" }, "by-hand", "2026-11-26");
  assert.ok(part.ok);
  assert.equal(part.ok && part.value.invoice.status, "sent");
  assert.equal(part.ok && part.value.refund.amount.minor, 2500);
  assert.deepEqual(refundPayment(invoice, payment, 8000, ids, { amount: "25", on: "2026-11-25" }, "by-hand", "2026-11-26"), { ok: false, error: "more-than-was-paid" });
  assert.deepEqual(refundPayment(invoice, payment, 0, ids, { amount: "0", on: "2026-11-25" }, "by-hand", "2026-11-26"), { ok: false, error: "amount-must-be-positive" });
  assert.deepEqual(refundPayment(invoice, payment, 0, ids, { amount: "5", on: "2026-11-30" }, "by-hand", "2026-11-26"), { ok: false, error: "date-in-future" });
  assert.deepEqual(refundPayment(invoice, payment, 0, ids, { amount: "5", on: "2026-11-25", reference: "4242 4242 4242 4242" }, "by-hand", "2026-11-26"), { ok: false, error: "looks-like-a-card-number" });
  const voided = refundPayment({ ...invoice, status: "void" } as never, payment, 0, ids, { amount: "5", on: "2026-11-25" }, "by-hand", "2026-11-26");
  assert.equal(voided.ok && voided.value.invoice.status, "void", "a written-off invoice stays written off");
});
