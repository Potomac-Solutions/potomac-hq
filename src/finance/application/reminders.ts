// Reminders emailed to clients about invoices coming due and overdue. Off
// until someone with `finance.edit` turns them on, and can be stopped for one
// invoice. Run by HQ each morning; each reminder is recorded before it is
// sent, so none goes twice.
import { invoiceLabel } from "../domain/invoice.ts";
import { REMINDER_LABELS, reminderDue, reminderEmail } from "../domain/reminders.ts";
import { receiptEmail, statementEmail } from "../domain/client-mail.ts";
import { METHOD_LABELS } from "../domain/labels.ts";
import { authorize } from "../../identity/index.ts";
import { err, formatMoney, friendlyDay, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { FinanceDeps, Refused } from "./commands.ts";
import type { ClientEmails, ReminderStore } from "./ports.ts";

export type RemindersDeps = FinanceDeps & { readonly reminders: ReminderStore; readonly clientEmails: ClientEmails };
export type ReminderMail = (message: { readonly to: string; readonly subject: string; readonly body: string }) => Promise<boolean>;
export type ReminderOptions = { readonly publicUrl: string; readonly phone: string; readonly address: string };

const allowed = (deps: FinanceDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;

/** Turns reminders on or off for every invoice. Permission: `finance.edit`. */
export function setInvoiceReminders(deps: RemindersDeps, actorId: Id | null, on: boolean): Result<{ readonly on: boolean }, "forbidden"> {
  if (!allowed(deps, actorId, "finance.edit")) return err("forbidden");
  return deps.transact(() => {
    deps.reminders.setOn(on, actorId, deps.clock());
    recordActivity(deps, { actorId, action: on ? "invoice-reminders.on" : "invoice-reminders.off", recordType: "finance-setting", recordId: deps.newId() });
    return ok({ on });
  });
}

/** Stops reminders for one invoice, or lets them go again. Permission: `invoice.edit`. */
export function setRemindersForInvoice(deps: RemindersDeps, actorId: Id | null, invoiceId: Id, off: boolean): Result<{ readonly invoiceId: Id }, Refused> {
  if (!allowed(deps, actorId, "invoice.edit")) return err("forbidden");
  return deps.transact(() => {
    const invoice = deps.invoices.get(invoiceId);
    if (!invoice) return err("not-found");
    deps.reminders.setOff(invoiceId, off, actorId, deps.clock());
    recordActivity(deps, { actorId, action: off ? "invoice.reminders-stopped" : "invoice.reminders-allowed", recordType: "invoice", recordId: invoiceId, context: { projectId: invoice.projectId, number: invoice.number } });
    return ok({ invoiceId });
  });
}

export type InvoiceRemindersView = {
  readonly on: boolean;
  readonly off: boolean;
  readonly recipients: string;
  readonly sent: readonly { readonly label: string; readonly when: string; readonly to: string }[];
  readonly canEdit: boolean;
};

/** For an invoice's page. Permission: `invoice.view`. */
export function invoiceReminders(deps: RemindersDeps, actorId: Id | null, invoiceId: Id): Result<InvoiceRemindersView, Refused> {
  if (!allowed(deps, actorId, "invoice.view")) return err("forbidden");
  const invoice = deps.invoices.get(invoiceId);
  if (!invoice) return err("not-found");
  return ok({
    on: deps.reminders.on(),
    off: deps.reminders.isOff(invoiceId),
    recipients: deps.clientEmails(invoice.organizationId).map((one) => one.email).join(", "),
    sent: deps.reminders.sent(invoiceId).map((one) => ({ label: REMINDER_LABELS[one.kind], when: deps.formatWhen(one.sentAt), to: one.sentTo })),
    canEdit: allowed(deps, actorId, "invoice.edit"),
  });
}

/** Sends today's reminders. Answers how many went, and how many could not. */
export async function sendInvoiceReminders(deps: RemindersDeps, mail: ReminderMail, options: ReminderOptions): Promise<{ readonly sent: number; readonly failed: number; readonly skipped: number }> {
  if (!deps.reminders.on()) return { sent: 0, failed: 0, skipped: 0 };
  const today = deps.today();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const invoice of deps.invoices.list()) {
    if (invoice.status !== "sent" || deps.reminders.isOff(invoice.id)) continue;
    const kind = reminderDue({ status: invoice.status, dueOn: invoice.dueOn, owedMinor: invoice.total.minor - invoice.paidMinor }, today, deps.reminders.sent(invoice.id).map((one) => one.kind));
    if (!kind) continue;
    const to = deps.clientEmails(invoice.organizationId);
    if (to.length === 0) {
      skipped++;
      continue;
    }
    // Recorded first: a reminder that fails to send is not tried again.
    deps.transact(() => {
      deps.reminders.record(invoice.id, kind, deps.clock(), to.map((one) => one.email).join(", "));
      recordActivity(deps, { actorId: null, action: "invoice.reminder-sent", recordType: "invoice", recordId: invoice.id, context: { projectId: invoice.projectId, number: invoice.number, kind } });
    });
    for (const person of to) {
      const message = reminderEmail({
        kind,
        name: person.name,
        businessName: invoice.clientName,
        label: invoiceLabel(invoice.number),
        owed: formatMoney({ minor: invoice.total.minor - invoice.paidMinor, currency: invoice.total.currency }),
        due: friendlyDay(invoice.dueOn as string, today),
        projectName: invoice.projectName,
        portalUrl: person.portal ? `${options.publicUrl}/portal` : null,
        phone: options.phone,
        address: options.address,
        instructions: deps.billing.payInstructions(),
      });
      try {
        if (await mail({ to: person.email, ...message })) sent++;
        else failed++;
      } catch {
        failed++;
      }
    }
  }
  return { sent, failed, skipped };
}

/** Receipts look back this far, so turning emails on doesn't send old ones. */
const RECEIPT_LOOKBACK_DAYS = 3;

/**
 * Emails a receipt for each payment recorded in the last few days that has
 * none yet, to whoever gets the client's bills. Only when invoice emails are
 * on. Recorded first, so a receipt is never sent twice.
 */
export async function sendReceipts(deps: RemindersDeps, mail: ReminderMail, options: ReminderOptions): Promise<{ readonly sent: number; readonly failed: number }> {
  if (!deps.reminders.on()) return { sent: 0, failed: 0 };
  const since = Temporal.Instant.from(deps.clock()).subtract({ hours: 24 * RECEIPT_LOOKBACK_DAYS }).toString();
  const today = deps.today();
  let sent = 0;
  let failed = 0;
  for (const { payment, invoiceId } of deps.billing.paymentsWithoutReceipt(since)) {
    const invoice = deps.invoices.get(invoiceId);
    if (!invoice) continue;
    const to = deps.clientEmails(invoice.organizationId);
    deps.transact(() => {
      deps.billing.markReceipt(payment.id, deps.clock(), to.map((one) => one.email).join(", "));
      recordActivity(deps, { actorId: null, action: "payment.receipt-sent", recordType: "invoice", recordId: invoice.id, context: { paymentId: payment.id, number: invoice.number, to: to.length } });
    });
    const owed = invoice.total.minor - invoice.paidMinor;
    for (const person of to) {
      const message = receiptEmail({
        name: person.name,
        businessName: invoice.clientName,
        label: invoiceLabel(invoice.number),
        amount: formatMoney(payment.amount),
        on: friendlyDay(payment.receivedOn, today),
        method: METHOD_LABELS[payment.method] ?? payment.method,
        stillOwed: owed > 0 && invoice.status !== "paid" ? formatMoney({ minor: owed, currency: invoice.total.currency }) : "",
        portalUrl: person.portal ? `${options.publicUrl}/portal#invoices` : null,
        phone: options.phone,
      });
      try {
        if (await mail({ to: person.email, ...message })) sent++;
        else failed++;
      } catch {
        failed++;
      }
    }
  }
  return { sent, failed };
}

/** Statements go out in the first week of a month, once a client each month. */
const STATEMENT_DAYS = 7;

/**
 * At the start of a month, one email to each client who still owes money,
 * listing every open invoice, instead of one email per invoice. Only when
 * invoice emails are on; demo clients are left out.
 */
export async function sendStatements(deps: RemindersDeps, mail: ReminderMail, options: ReminderOptions): Promise<{ readonly sent: number; readonly failed: number }> {
  if (!deps.reminders.on()) return { sent: 0, failed: 0 };
  const today = Temporal.PlainDate.from(deps.today());
  if (today.day > STATEMENT_DAYS) return { sent: 0, failed: 0 };
  const month = today.toString().slice(0, 7);
  const monthLabel = today.toLocaleString("en-US", { month: "long", year: "numeric" });
  const open = deps.invoices.list().filter((one) => one.status === "sent" && one.total.minor - one.paidMinor > 0);
  const byClient = new Map<Id, typeof open>();
  for (const one of open) byClient.set(one.organizationId, [...(byClient.get(one.organizationId) ?? []), one]);
  let sent = 0;
  let failed = 0;
  for (const [organizationId, invoices] of byClient) {
    if (deps.clients.get(organizationId)?.demo || deps.billing.statementSent(organizationId, month)) continue;
    const to = deps.clientEmails(organizationId);
    if (to.length === 0) continue;
    deps.transact(() => {
      deps.billing.markStatement(organizationId, month, deps.clock(), to.map((one) => one.email).join(", "));
      recordActivity(deps, { actorId: null, action: "client.statement-sent", recordType: "client", recordId: organizationId, context: { month, invoices: invoices.length } });
    });
    const total = invoices.reduce((sum, one) => sum + one.total.minor - one.paidMinor, 0);
    for (const person of to) {
      const message = statementEmail({
        name: person.name,
        businessName: invoices[0]?.clientName ?? "",
        month: monthLabel,
        invoices: invoices.map((one) => ({
          label: invoiceLabel(one.number),
          forWhat: one.projectName || one.lines[0]?.description || "",
          owed: formatMoney({ minor: one.total.minor - one.paidMinor, currency: one.total.currency }),
          due: one.dueOn ? friendlyDay(one.dueOn, today.toString()) : "",
          overdue: one.dueOn !== null && one.dueOn < today.toString(),
        })),
        total: formatMoney({ minor: total, currency: "USD" }),
        instructions: deps.billing.payInstructions(),
        address: options.address,
        portalUrl: person.portal ? `${options.publicUrl}/portal#invoices` : null,
        phone: options.phone,
      });
      try {
        if (await mail({ to: person.email, ...message })) sent++;
        else failed++;
      } catch {
        failed++;
      }
    }
  }
  return { sent, failed };
}
