// Refunding a payment (2026-11-26): through the payment platform when it came
// from one, or recorded by hand when the money went back some other way.
import { Hono } from "hono";
import { planRefund, recordRefund, type RefundRequest } from "../../finance/index.ts";
import { formPosts, type FormFields, type Id } from "../../shared/index.ts";
import { refundThroughPlatform, PLATFORM_LABELS, type CardPayDeps } from "../application/card-pay.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That payment doesn’t exist.",
  "not-an-amount": "Enter an amount like 25.00.",
  "amount-must-be-positive": "Enter an amount above zero.",
  "more-than-was-paid": "That’s more than is left of this payment to give back.",
  "refund-reason-too-long": "Keep the reason under 300 characters.",
  "reference-too-long": "Keep the reference under 100 characters.",
  "looks-like-a-card-number": "That looks like a card number. HQ never keeps one.",
  "date-in-future": "That day hasn’t happened yet.",
  "invalid-date": "Enter the day it was given back.",
  "write-off-note-missing": "Say why they no longer owe it: it goes on the invoice.",
  "refund-not-through-platform": "This payment didn’t come through the payment platform, so HQ can’t refund it there. Give the money back yourself, then record it here.",
  "refund-failed": "The payment platform didn’t make the refund. Nothing was recorded. Try again, or refund it on the platform’s own site and record it here.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Nothing was changed.";

const request = (form: FormFields): RefundRequest => ({ amount: form["amount"] ?? "", on: form["on"] ?? "", reason: form["reason"] ?? null, reference: form["reference"] ?? null, noLongerOwed: form["noLongerOwed"] === "on" });
const backTo = (form: FormFields): string => (/^[0-9a-f-]{36}$/.test(form["invoice"] ?? "") ? `/invoices/${form["invoice"]}#invoice-payments` : "/money/invoices");

export function refundRoutes(deps: { readonly cardPay: CardPayDeps; readonly finance: Parameters<typeof recordRefund>[0]; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/money/invoices" });
  post(
    "/payments/:id/refund",
    async (actor, form, id) => {
      const paymentId = id as Id;
      const wanted = request(form);
      if (form["how"] !== "platform") return recordRefund(deps.finance, actor, paymentId, wanted, "by-hand");
      return refundThroughPlatform(deps.cardPay, paymentId, {
        plan: () => planRefund(deps.finance, actor, paymentId, wanted),
        record: (reference) => recordRefund(deps.finance, actor, paymentId, { ...wanted, reference }, "platform"),
      });
    },
    {
      done: (value) => `/invoices/${value.invoice.id}#invoice-payments`,
      back: (_, form) => backTo(form),
      message: (value) =>
        value.refund.through === "platform"
          ? `Refunded through ${PLATFORM_LABELS[deps.cardPay.platform] ?? "the payment platform"}. The client gets the money back from them.`
          : value.invoice.status === "void"
            ? "Refund recorded, and the rest written off."
            : value.invoice.status === "sent"
              ? "Refund recorded. The invoice is owed again by what was given back."
              : "Refund recorded.",
    },
  );
  return app;
}
