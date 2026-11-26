// Paying an invoice by card from the portal (decision 0018). The payment
// platform takes the card on its own page; HQ starts the payment, sends the
// client there, and records the payment once the platform says it was paid.
// Which platform is one setting. The kit's `pay` keeps "paid at most once".
import { invoiceLabel, type Invoice } from "../../finance/index.ts";
import { err, formatMoney, ok, parseId, recordActivity, type ActivityLog, type Clock, type Id, type IdSource, type Result, type Transact } from "../../shared/index.ts";

/** What a platform that pays in a frame needs on the page: which frame, its script, its token. */
export type PayFrame = { readonly kind: string; readonly script: string; readonly token: string };
/** What the platform said about a payment HQ started. */
export type Settled = { ok: true; id: string; ref: string; cents: number; currency: string; payment: string; again?: true } | { ok?: undefined; error: string; id?: string; ref?: string; payment?: string };
/** The part of the kit's `pay` HQ uses. It keeps "paid at most once"; the platform is behind it. */
export type CardPayments = {
  paid(id: string): { state?: string; url?: string; frame?: PayFrame | null; ref?: string } | null;
  start(input: { id: string; cents: number; currency?: string; description?: string; back?: string; cancel?: string }): Promise<{ ok: true; ref: string } | { ok?: undefined; error: string }>;
  settle(input: { id?: string; ref?: string; told?: string }): Promise<Settled>;
  heard(request: { headers: Record<string, string | string[] | undefined>; body: string; url: string }): Promise<Settled | { ok?: undefined; error?: undefined; ignore: true }>;
};

/** The words for each platform, where a client reads them. */
export const PLATFORM_LABELS: Readonly<Record<string, string>> = { stripe: "Stripe", square: "Square", paypal: "PayPal", helcim: "Helcim", test: "a test page" };

export type CardPayDeps = {
  /** Null when no platform is set up. */
  readonly pay: CardPayments | null;
  /** 'stripe', 'square', 'paypal', 'helcim' or 'test'; "" when none. */
  readonly platform: string;
  /** HQ's own address, for where the platform sends the client back. */
  readonly publicUrl: string;
  readonly invoice: (id: Id) => (Invoice & { readonly paidMinor: number }) | null;
  readonly record: (invoiceId: Id, input: { readonly minor: number; readonly platform: string; readonly reference: string }) => Result<unknown, string>;
  /** Whether a kit payment has been put on its invoice, and saying it has. */
  readonly recorded: (payId: string) => boolean;
  readonly markRecorded: (payId: string, how: "recorded" | "unmatched") => void;
  readonly activityLog: ActivityLog;
  readonly transact: Transact;
  readonly clock: Clock;
  readonly newId: IdSource;
  readonly log: (message: string) => void;
};

export type CardPayReady = { readonly on: boolean; readonly platform: string; readonly label: string; readonly test: boolean };

export const cardPayReady = (deps: CardPayDeps): CardPayReady => ({ on: deps.pay !== null, platform: deps.platform, label: PLATFORM_LABELS[deps.platform] ?? "", test: deps.platform === "test" });

/** One kit payment per balance: after a part payment the next one is a new payment. */
const payIdOf = (invoice: { readonly id: Id; readonly paidMinor: number }): string => `invoice/${invoice.id}/${invoice.paidMinor}`;
const invoiceOf = (payId: string): Id | null => {
  const parsed = parseId(payId.split("/")[1] ?? "");
  return parsed.ok ? parsed.value : null;
};
const owedOn = (invoice: Invoice & { readonly paidMinor: number }): number => Math.max(0, invoice.total.minor - invoice.paidMinor);

/**
 * Whether a started payment should still be taken: its invoice is still sent
 * and owes what it did when the payment started. PayPal takes the money only
 * when HQ asks, so a voided invoice, or one paid by check meanwhile, is never
 * charged. A platform that has already taken it is flagged instead.
 */
export function stillWanted(invoice: (id: Id) => (Invoice & { readonly paidMinor: number }) | null, payId: string): boolean {
  const id = invoiceOf(payId);
  const found = id ? invoice(id) : null;
  return found !== null && found.status === "sent" && payIdOf(found) === payId;
}

function mine(deps: CardPayDeps, session: { readonly organizationId: Id } | null, invoiceId: Id) {
  const invoice = session ? deps.invoice(invoiceId) : null;
  return invoice && session && invoice.organizationId === session.organizationId ? invoice : null;
}

export type StartError = "not-found" | "not-set-up" | "nothing-owed" | "in-progress" | "card-pay-failed";

/** The client pressed "Pay by card". Answers where to send them next, an address of HQ's own. */
export async function startCardPayment(deps: CardPayDeps, session: { readonly organizationId: Id } | null, invoiceId: Id): Promise<Result<{ readonly next: string }, StartError>> {
  const invoice = mine(deps, session, invoiceId);
  if (!invoice) return err("not-found");
  if (!deps.pay) return err("not-set-up");
  if (invoice.status !== "sent" || owedOn(invoice) === 0) return err("nothing-owed");
  const started = await deps.pay.start({
    id: payIdOf(invoice),
    cents: owedOn(invoice),
    currency: invoice.total.currency.toLowerCase(),
    description: `Potomac Solutions invoice ${invoiceLabel(invoice.number)}`,
    back: `${deps.publicUrl}/portal/invoices/${invoice.id}/paid`,
    cancel: `${deps.publicUrl}/portal/invoices/${invoice.id}/not-paid`,
  });
  // Paid at the platform already (a second tab, a slow webhook): go and record it.
  if (!started.ok && started.error === "paid") return ok({ next: `/portal/invoices/${invoice.id}/paid` });
  if (!started.ok) {
    if (started.error !== "in-progress") deps.log(`Card payment could not start (${deps.platform}): ${started.error}`);
    return err(started.error === "in-progress" ? "in-progress" : "card-pay-failed");
  }
  return ok({ next: `/portal/invoices/${invoice.id}/pay` });
}

export type PayStep = {
  readonly invoiceId: Id;
  readonly label: string;
  readonly amount: string;
  readonly platformLabel: string;
  readonly test: boolean;
  /** The platform's page, or "" when it pays in a frame on a page of HQ's. */
  readonly url: string;
  readonly frame: PayFrame | null;
  readonly ref: string;
};

/** The page between HQ and the platform: where the started payment is paid. Null when there is none. */
export function payStep(deps: CardPayDeps, session: { readonly organizationId: Id } | null, invoiceId: Id): PayStep | null {
  const invoice = mine(deps, session, invoiceId);
  if (!invoice || !deps.pay || invoice.status !== "sent") return null;
  const doc = deps.pay.paid(payIdOf(invoice));
  if (!doc || doc.state !== "started" || (!doc.url && !doc.frame)) return null;
  return {
    invoiceId: invoice.id,
    label: invoiceLabel(invoice.number),
    amount: formatMoney({ minor: owedOn(invoice), currency: invoice.total.currency }),
    platformLabel: PLATFORM_LABELS[deps.platform] ?? "",
    test: deps.platform === "test",
    url: doc.url ?? "",
    frame: doc.frame ?? null,
    ref: doc.ref ?? "",
  };
}

export type Outcome = "paid" | "not-paid" | "paid-needs-a-look" | "closed" | "nothing";

/** Put a payment the platform confirmed on its invoice, once. */
function finish(deps: CardPayDeps, settled: Settled): Outcome {
  if (!settled.ok) {
    // Money taken that HQ can't put on the invoice: a second payment, or the wrong amount.
    if ((settled.error === "paid-twice" || settled.error === "wrong-amount") && settled.id) {
      const invoiceId = invoiceOf(settled.id);
      const key = `${settled.id}#${settled.ref ?? ""}`;
      if (invoiceId && !deps.recorded(key)) {
        deps.transact(() => {
          recordActivity(deps, { actorId: null, action: "payment.card-unmatched", recordType: "invoice", recordId: invoiceId, context: { why: settled.error, platform: deps.platform, reference: settled.payment ?? "" } });
          deps.markRecorded(key, "unmatched");
        });
        deps.log(`Card payment to refund (${deps.platform} ${settled.payment ?? settled.ref ?? ""}): ${settled.error}`);
      }
      return "paid-needs-a-look";
    }
    return settled.error === "no-payment" ? "nothing" : "not-paid";
  }
  const invoiceId = invoiceOf(settled.id);
  if (!invoiceId) return "nothing";
  // No await from here: the check and the record are one step, so two answers at once record once.
  if (deps.recorded(settled.id)) return "paid";
  const recorded = deps.record(invoiceId, { minor: settled.cents, platform: PLATFORM_LABELS[deps.platform] ?? deps.platform, reference: settled.payment || settled.ref });
  if (recorded.ok) {
    deps.markRecorded(settled.id, "recorded");
    return "paid";
  }
  // Paid at the platform, but the invoice changed meanwhile (voided, or paid another way).
  deps.transact(() => {
    recordActivity(deps, { actorId: null, action: "payment.card-unmatched", recordType: "invoice", recordId: invoiceId, context: { why: recorded.error, platform: deps.platform, reference: settled.payment || settled.ref, minor: settled.cents } });
    deps.markRecorded(settled.id, "unmatched");
  });
  deps.log(`Card payment taken but not recorded (${deps.platform} ${settled.payment || settled.ref}): ${recorded.error}`);
  return "paid-needs-a-look";
}

/**
 * The client came back from the platform (or its frame said `told`). Anyone
 * may open the address: it only asks the platform about a payment HQ started.
 */
export async function settleCardPayment(deps: CardPayDeps, invoiceId: Id, told?: string): Promise<Outcome> {
  const invoice = deps.invoice(invoiceId);
  if (!invoice || !deps.pay) return "nothing";
  if (invoice.status === "paid") return "paid";
  const outcome = finish(deps, await deps.pay.settle({ id: payIdOf(invoice), ...(told === undefined ? {} : { told }) }));
  // No longer open (voided or written off), and the platform took nothing.
  return invoice.status !== "sent" && (outcome === "not-paid" || outcome === "nothing") ? "closed" : outcome;
}

/** The platform's webhook. 'refuse' is a request that wasn't the platform's. */
export async function hearCardPayment(deps: CardPayDeps, request: { readonly headers: Record<string, string | string[] | undefined>; readonly body: string; readonly url: string }): Promise<"heard" | "refuse" | "off"> {
  if (!deps.pay) return "off";
  const heard = await deps.pay.heard(request);
  if ("ignore" in heard) return "heard";
  if (!heard.ok && (heard.error === "bad-signature" || heard.error === "no-webhook")) return "refuse";
  finish(deps, heard);
  return "heard";
}
