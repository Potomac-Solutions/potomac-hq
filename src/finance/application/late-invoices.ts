// Late invoices (2026-11-26): an optional late fee, charged once as its own
// invoice, and a to-do to call the client when one is two weeks late. Run
// each morning with the reminders, whether or not email is set up.
import { invoiceLabel, newInvoice, sendInvoice } from "../domain/invoice.ts";
import { CALL_AFTER_DAYS, daysLate, lateFeeDue, lateFeeWords, readLateFee, type LateFeeError, type LateFeeSetting } from "../domain/late-fees.ts";
import { authorize } from "../../identity/index.ts";
import { err, formatMoney, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { RemindersDeps } from "./reminders.ts";

export type LateFeeStore = {
  setting(): LateFeeSetting;
  set(setting: LateFeeSetting, by: Id, at: string): void;
  charged(invoiceId: Id): boolean;
  /** Whether this invoice is itself a late fee. */
  isFee(invoiceId: Id): boolean;
  record(invoiceId: Id, feeInvoiceId: Id, on: string): void;
  called(invoiceId: Id): boolean;
  recordCall(invoiceId: Id, todoId: Id | null, at: string): void;
};

export type LateDeps = RemindersDeps & {
  readonly lateFees: LateFeeStore;
  /** A to-do about the client, for someone. Inside the caller's transaction. */
  readonly makeTodo?: (input: { readonly projectId: null; readonly organizationId: Id; readonly title: string; readonly description: string; readonly assigneeId: Id | null }) => Result<{ readonly id: Id }, string>;
};

const may = (deps: LateDeps, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "finance.edit").ok;

export function lateFeeView(deps: LateDeps, actorId: Id | null): { readonly words: string; readonly kind: string; readonly amount: string; readonly afterDays: number; readonly canEdit: boolean } {
  const setting = deps.lateFees.setting();
  return {
    words: lateFeeWords(setting),
    kind: setting.kind,
    amount: setting.kind === "flat" ? (setting.amount / 100).toFixed(2) : setting.kind === "percent" ? String(setting.amount / 100) : "",
    afterDays: setting.afterDays,
    canEdit: may(deps, actorId),
  };
}

export function setLateFee(deps: LateDeps, actorId: Id | null, input: { readonly kind: string; readonly amount?: string | null; readonly afterDays?: string | null }): Result<LateFeeSetting, "forbidden" | LateFeeError> {
  if (!may(deps, actorId)) return err("forbidden");
  const read = readLateFee(input);
  if (!read.ok) return read;
  return deps.transact(() => {
    deps.lateFees.set(read.value, actorId, deps.clock());
    recordActivity(deps, { actorId, action: "late-fee.set", recordType: "finance-setting", recordId: deps.newId(), context: { kind: read.value.kind, amount: read.value.amount, afterDays: read.value.afterDays } });
    return ok(read.value);
  });
}

/** The morning's work on late invoices: fees charged, calls asked for. */
export function runLateInvoices(deps: LateDeps): { readonly fees: number; readonly calls: number } {
  const today = deps.today();
  const setting = deps.lateFees.setting();
  let fees = 0;
  let calls = 0;
  for (const invoice of deps.invoices.list()) {
    if (invoice.status !== "sent" || invoice.dueOn === null) continue;
    const owed = invoice.total.minor - invoice.paidMinor;
    const isFee = deps.lateFees.isFee(invoice.id);
    const fee = lateFeeDue(setting, { status: invoice.status, dueOn: invoice.dueOn, owedMinor: owed, isFee, charged: deps.lateFees.charged(invoice.id) }, today);
    if (fee !== null) {
      const made = deps.transact(() => {
        if (deps.lateFees.charged(invoice.id)) return false;
        const late = daysLate(invoice.dueOn as string, today);
        const draft = newInvoice(
          { id: deps.newId(), organizationId: invoice.organizationId, projectId: invoice.projectId, number: deps.invoices.nextNumber(), createdBy: invoice.createdBy },
          { kind: "other", description: `Late fee on ${invoiceLabel(invoice.number)}, ${late} days past due`, amount: (fee / 100).toFixed(2), dueOn: Temporal.PlainDate.from(today).add({ days: 14 }).toString(), note: `Charged by HQ: ${lateFeeWords(setting)}.` },
        );
        if (!draft.ok) return false;
        const sent = sendInvoice(draft.value, today);
        if (!sent.ok) return false;
        const at = deps.clock();
        deps.invoices.insert(sent.value, at);
        deps.lateFees.record(invoice.id, sent.value.id, today);
        recordActivity(deps, { actorId: null, action: "invoice.late-fee", recordType: "invoice", recordId: sent.value.id, context: { lateInvoiceId: invoice.id, number: sent.value.number, of: invoice.number, minor: fee } });
        return true;
      });
      if (made) fees += 1;
    }
    if (!isFee && owed > 0 && deps.makeTodo && daysLate(invoice.dueOn, today) >= CALL_AFTER_DAYS && !deps.lateFees.called(invoice.id)) {
      deps.transact(() => {
        if (deps.lateFees.called(invoice.id)) return;
        const todo = deps.makeTodo?.({
          projectId: null,
          organizationId: invoice.organizationId,
          title: `Call ${invoice.clientName} about ${invoiceLabel(invoice.number)}`.slice(0, 120),
          description: `${formatMoney({ minor: owed, currency: invoice.total.currency })} still owed, ${daysLate(invoice.dueOn as string, today)} days past due. The reminder emails have gone; a call usually sorts it out.`,
          assigneeId: invoice.createdBy,
        });
        deps.lateFees.recordCall(invoice.id, todo?.ok ? todo.value.id : null, deps.clock());
        recordActivity(deps, { actorId: null, action: "invoice.call-asked", recordType: "invoice", recordId: invoice.id, context: { number: invoice.number } });
        calls += 1;
      });
    }
  }
  return { fees, calls };
}
