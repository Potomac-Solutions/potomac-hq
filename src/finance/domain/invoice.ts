// An invoice for a project, and the payments received against it
// (docs/tool-boundaries.md: invoicing is built into HQ). Cash and checks are
// entered by hand. HQ never sees a card number.
import { calendarDate, optionalText, requiredText } from "../../shared/domain/fields.ts";
import type { Id } from "../../shared/domain/id.ts";
import { parseAmount, type Money } from "../../shared/domain/money.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const INVOICE_STATUSES = ["draft", "sent", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** What the invoice is for. A deposit is one third of a fixed quote (docs/workflow.md, B4). */
export const INVOICE_KINDS = ["deposit", "balance", "full", "other"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const PAYMENT_METHODS = ["cash", "check", "card", "transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type InvoiceLine = { readonly description: string; readonly amount: Money };

export type Invoice = {
  readonly id: Id;
  /** The client billed. */
  readonly organizationId: Id;
  /** The project it is for, or null for a charge on the client alone, such as a domain. */
  readonly projectId: Id | null;
  /** 1, 2, 3… in the order invoices were made. Shown as INV-0001. */
  readonly number: number;
  readonly kind: InvoiceKind;
  readonly status: InvoiceStatus;
  readonly lines: readonly InvoiceLine[];
  readonly total: Money;
  /** YYYY-MM-DD. Set when it is sent. */
  readonly issuedOn: string | null;
  readonly dueOn: string | null;
  readonly note: string;
  readonly createdBy: Id;
  /** The day the client promised to pay, and what they said. Null and "" when none. */
  readonly promisedOn: string | null;
  readonly promiseNote: string;
  /** A card payment link Potomac made itself with its payment service, shown in the portal. */
  readonly payLink: string | null;
  /** Written off: voided as money that won't come, kept apart from a mistake. */
  readonly writtenOffOn: string | null;
  readonly writtenOffNote: string;
};

/** What Potomac adds to a sent invoice after the fact: a promise, a payment link, a write-off. */
export const NO_EXTRAS = { promisedOn: null, promiseNote: "", payLink: null, writtenOffOn: null, writtenOffNote: "" } as const;

export type Payment = {
  readonly id: Id;
  readonly invoiceId: Id;
  readonly amount: Money;
  readonly method: PaymentMethod;
  /** YYYY-MM-DD. */
  readonly receivedOn: string;
  /** A check number, or the gateway's reference. Never a card number. */
  readonly reference: string;
  readonly recordedBy: Id;
};

/** One third of an amount, rounded up to the cent: the deposit (docs/workflow.md, B4). */
export const depositShare = (minor: number): number => Math.ceil(minor / 3);

/** INV-0001 */
export const invoiceLabel = (number: number): string => `INV-${String(number).padStart(4, "0")}`;

export type InvoiceInput = { readonly kind: string; readonly description: string; readonly amount: string; readonly dueOn?: string | null; readonly note?: string | null };
export type InvoiceError = "project-needed" | "invalid-invoice-kind" | "description-missing" | "description-too-long" | "not-an-amount" | "amount-must-be-positive" | "invalid-date" | "note-too-long";

/** A new draft with one line. More lines can be added while it is a draft. */
export function newInvoice(ids: { readonly id: Id; readonly organizationId: Id; readonly projectId: Id | null; readonly number: number; readonly createdBy: Id }, input: InvoiceInput): Result<Invoice, InvoiceError> {
  if (!(INVOICE_KINDS as readonly string[]).includes(input.kind)) return err("invalid-invoice-kind");
  // A deposit or a balance is against a project's budget; a charge on the client alone is "full" or "other".
  if (ids.projectId === null && (input.kind === "deposit" || input.kind === "balance")) return err("project-needed");
  const line = invoiceLine(input);
  if (!line.ok) return line;
  const due = (input.dueOn ?? "").trim();
  const dueOn = due === "" ? ok(null) : calendarDate(due);
  if (!dueOn.ok) return dueOn;
  const note = optionalText(input.note, 1000);
  if (!note.ok) return err("note-too-long");
  return ok({ ...ids, kind: input.kind as InvoiceKind, status: "draft", lines: [line.value], total: line.value.amount, issuedOn: null, dueOn: dueOn.value, note: note.value ?? "", ...NO_EXTRAS });
}

function invoiceLine(input: { readonly description: string; readonly amount: string }): Result<InvoiceLine, "description-missing" | "description-too-long" | "not-an-amount" | "amount-must-be-positive"> {
  const description = requiredText(input.description, 300);
  if (!description.ok) return err(description.error === "missing" ? "description-missing" : "description-too-long");
  const amount = parseAmount(input.amount, "USD");
  if (!amount.ok) return err("not-an-amount");
  if (amount.value.minor <= 0) return err("amount-must-be-positive");
  return ok({ description: description.value, amount: amount.value });
}

export const MAX_INVOICE_LINES = 30;

export function addInvoiceLine(invoice: Invoice, input: { readonly description: string; readonly amount: string }): Result<Invoice, "not-a-draft" | "too-many-lines" | "description-missing" | "description-too-long" | "not-an-amount" | "amount-must-be-positive"> {
  if (invoice.status !== "draft") return err("not-a-draft");
  if (invoice.lines.length >= MAX_INVOICE_LINES) return err("too-many-lines");
  const line = invoiceLine(input);
  if (!line.ok) return line;
  const lines = [...invoice.lines, line.value];
  return ok({ ...invoice, lines, total: { minor: lines.reduce((sum, one) => sum + one.amount.minor, 0), currency: "USD" } });
}

/**
 * Takes a credit off a draft (a referral credit, decision 0013): a line with
 * a negative amount. It never makes the invoice zero or less.
 */
export function addCreditLine(invoice: Invoice, input: { readonly description: string; readonly minor: number }): Result<Invoice, "not-a-draft" | "too-many-lines" | "description-missing" | "description-too-long" | "amount-must-be-positive" | "credit-too-large"> {
  if (invoice.status !== "draft") return err("not-a-draft");
  if (invoice.lines.length >= MAX_INVOICE_LINES) return err("too-many-lines");
  const description = requiredText(input.description, 300);
  if (!description.ok) return err(description.error === "missing" ? "description-missing" : "description-too-long");
  if (!Number.isSafeInteger(input.minor) || input.minor <= 0) return err("amount-must-be-positive");
  if (invoice.total.minor - input.minor <= 0) return err("credit-too-large");
  const lines = [...invoice.lines, { description: description.value, amount: { minor: -input.minor, currency: "USD" as const } }];
  return ok({ ...invoice, lines, total: { minor: lines.reduce((sum, one) => sum + one.amount.minor, 0), currency: "USD" } });
}

/** A sent invoice cannot be edited: it is what the client was asked to pay. */
export function sendInvoice(invoice: Invoice, today: string): Result<Invoice, "not-a-draft"> {
  if (invoice.status !== "draft") return err("not-a-draft");
  return ok({ ...invoice, status: "sent", issuedOn: today });
}

export type PromiseError = "not-sent" | "invalid-date" | "promise-note-too-long";

/** The client said when they'll pay. An empty day clears it. Only on a sent invoice. */
export function promisePayment(invoice: Invoice, input: { readonly on: string; readonly note?: string | null }): Result<Invoice, PromiseError> {
  if (invoice.status !== "sent") return err("not-sent");
  const text = input.on.trim();
  if (text === "") return ok({ ...invoice, promisedOn: null, promiseNote: "" });
  const on = calendarDate(text);
  if (!on.ok) return err("invalid-date");
  const note = optionalText(input.note, 300);
  if (!note.ok) return err("promise-note-too-long");
  return ok({ ...invoice, promisedOn: on.value, promiseNote: note.value ?? "" });
}

export type PayLinkError = "already-paid" | "link-not-https" | "link-too-long";

/** A card payment link from Potomac's payment service: https only. Empty clears it. */
export function setPayLink(invoice: Invoice, link: string): Result<Invoice, PayLinkError> {
  if (invoice.status === "paid" || invoice.status === "void") return err("already-paid");
  const text = link.trim();
  if (text === "") return ok({ ...invoice, payLink: null });
  if (text.length > 500) return err("link-too-long");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return err("link-not-https");
  }
  if (url.protocol !== "https:" || url.username || url.password) return err("link-not-https");
  return ok({ ...invoice, payLink: url.toString() });
}

export type WriteOffError = "not-sent" | "write-off-note-missing" | "write-off-note-too-long";

/**
 * Money that won't come: a sent invoice is voided and marked written off,
 * with why, so the books show what happened and a mistake stays a mistake.
 * Payments already received stay received.
 */
export function writeOff(invoice: Invoice, input: { readonly note: string }, today: string): Result<Invoice, WriteOffError> {
  if (invoice.status !== "sent") return err("not-sent");
  const note = requiredText(input.note, 300);
  if (!note.ok) return err(note.error === "missing" ? "write-off-note-missing" : "write-off-note-too-long");
  return ok({ ...invoice, status: "void", writtenOffOn: today, writtenOffNote: note.value, promisedOn: null, promiseNote: "" });
}

/** A mistake is voided, never deleted, so the numbers have no gaps. A paid invoice stays paid. */
export function voidInvoice(invoice: Invoice): Result<Invoice, "already-void" | "already-paid"> {
  if (invoice.status === "void") return err("already-void");
  if (invoice.status === "paid") return err("already-paid");
  return ok({ ...invoice, status: "void" });
}

export type PaymentInput = { readonly amount: string; readonly method: string; readonly on: string; readonly reference?: string | null };
export type PaymentError = "not-sent" | "not-an-amount" | "amount-must-be-positive" | "more-than-is-owed" | "invalid-payment-method" | "invalid-date" | "date-in-future" | "reference-too-long" | "looks-like-a-card-number";

/**
 * Records money received. The invoice becomes paid when what has been
 * received reaches its total. `alreadyPaid` is the sum of earlier payments.
 */
export function receivePayment(
  invoice: Invoice,
  alreadyPaid: number,
  ids: { readonly id: Id; readonly recordedBy: Id },
  input: PaymentInput,
  today: string,
): Result<{ invoice: Invoice; payment: Payment }, PaymentError> {
  if (invoice.status !== "sent") return err("not-sent");
  const amount = parseAmount(input.amount, "USD");
  if (!amount.ok) return err("not-an-amount");
  if (amount.value.minor <= 0) return err("amount-must-be-positive");
  if (alreadyPaid + amount.value.minor > invoice.total.minor) return err("more-than-is-owed");
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) return err("invalid-payment-method");
  const on = calendarDate(input.on.trim());
  if (!on.ok) return on;
  if (on.value > today) return err("date-in-future");
  const reference = optionalText(input.reference, 100);
  if (!reference.ok) return err("reference-too-long");
  // Rule 1 of docs/tool-boundaries.md: HQ never sees a card number.
  if (reference.value !== null && /(?:\d[ -]?){13,19}/.test(reference.value)) return err("looks-like-a-card-number");
  const paid = alreadyPaid + amount.value.minor === invoice.total.minor;
  return ok({
    invoice: paid ? { ...invoice, status: "paid" } : invoice,
    payment: { ...ids, invoiceId: invoice.id, amount: amount.value, method: input.method as PaymentMethod, receivedOn: on.value, reference: reference.value ?? "" },
  });
}

/**
 * Where a project's payment stands after one of its invoices changed. Null
 * when the change says nothing new. A paid deposit is "deposit paid". Any
 * other invoice paid, with none left waiting, is "paid". An invoice sent and
 * waiting is "invoiced".
 */
export function paymentStatusAfter(changed: Invoice, all: readonly Invoice[]): "deposit-paid" | "invoiced" | "paid" | null {
  const waiting = all.some((invoice) => invoice.status === "sent");
  if (changed.status === "sent") return "invoiced";
  if (changed.status !== "paid") return null;
  if (waiting) return "invoiced";
  return changed.kind === "deposit" ? "deposit-paid" : "paid";
}
