// Reminders emailed to clients about invoices coming due and overdue. Off
// until someone with `finance.edit` turns them on, and can be stopped for one
// invoice. Run by HQ each morning; each reminder is recorded before it is
// sent, so none goes twice.
import { invoiceLabel } from "../domain/invoice.ts";
import { REMINDER_LABELS, reminderDue, reminderEmail } from "../domain/reminders.ts";
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
