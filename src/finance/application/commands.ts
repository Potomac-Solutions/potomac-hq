// The finance module's changes: time, the timer, expenses, budgets and
// payment status. Each one checks permission first, makes its change and
// writes its activity event in one transaction, and answers with a code.
import { defaultFinance, setBudget, setPayment, type BudgetError, type BudgetInput, type ProjectFinance } from "../domain/budget.ts";
import { newExpense, type Expense, type ExpenseError, type ExpenseInput } from "../domain/expense.ts";
import { addCreditLine, addInvoiceLine, newInvoice, paymentStatusAfter, promisePayment, receivePayment, sendInvoice, setPayLink, voidInvoice, writeOff, type Invoice, type PayLinkError, type PromiseError, type WriteOffError, type InvoiceError, type InvoiceInput, type Payment, type PaymentError, type PaymentInput } from "../domain/invoice.ts";
import { newBlock, type BlockError, type BlockInput, type PrepaidBlock } from "../domain/prepaid.ts";
import { logEntry, startEntry, stopEntry, type TimeEntry, type TimeError, type TimeInput } from "../domain/time.ts";
import { isDue, newRecurring, nextAfter, periodLine, type RecurringError, type RecurringInput, type RecurringInvoice } from "../domain/recurring.ts";
import type { CrmDeps } from "../../crm/index.ts";
import { saveFile, type UploadError } from "../../files/index.ts";
import { authorize } from "../../identity/index.ts";
import type { ProjectsDeps, Task } from "../../projects/index.ts";
import { err, ok, recordActivity, type Id, type Money, type Result } from "../../shared/index.ts";
import type { BillingStore, ChangeRequestStore, ExpenseStore, FinanceStore, InvoiceStore, RecurringStore, PhaseEstimates, TimeStore } from "./ports.ts";

export type FinanceDeps = ProjectsDeps &
  Pick<CrmDeps, "opportunities" | "clients"> & {
    readonly time: TimeStore;
    readonly expenses: ExpenseStore;
    readonly finance: FinanceStore;
    readonly invoices: InvoiceStore;
    readonly recurring: RecurringStore;
    readonly billing: BillingStore;
    /** Renewals' money in and out between two days, for the cash forecast. Absent: none counted. */
    readonly cashflow?: (from: string, to: string) => readonly { readonly on: string; readonly label: string; readonly organizationId: string; readonly inMinor: number; readonly outMinor: number }[];
    readonly phaseEstimates: PhaseEstimates;
    readonly changes: ChangeRequestStore;
  };

export type Refused = "forbidden" | "not-found";

function allowed(deps: FinanceDeps, actorId: Id | null, action: string): actorId is Id {
  return actorId !== null && authorize(deps, actorId, action).ok;
}

/** Logs time the actor worked. `taskId`, when given, must be a task of the project. */
export function logTime(deps: FinanceDeps, actorId: Id | null, where: { readonly projectId: Id; readonly taskId?: Id | null }, input: TimeInput): Result<TimeEntry, Refused | "task-not-in-project" | TimeError> {
  if (!allowed(deps, actorId, "time.log")) return err("forbidden");
  return deps.transact(() => {
    if (!deps.projects.get(where.projectId)) return err("not-found");
    if (where.taskId && deps.tasks.get(where.taskId)?.projectId !== where.projectId) return err("task-not-in-project");
    const entry = logEntry({ id: deps.newId(), projectId: where.projectId, taskId: where.taskId ?? null, userId: actorId }, input, deps.today());
    if (!entry.ok) return entry;
    deps.time.insert(entry.value, deps.clock());
    recordActivity(deps, {
      actorId,
      action: "time.logged",
      recordType: "time-entry",
      recordId: entry.value.id,
      context: { projectId: where.projectId, taskId: entry.value.taskId, on: entry.value.workedOn, minutes: entry.value.minutes, billable: entry.value.billable },
    });
    return ok(entry.value);
  });
}

/** Stops one running entry and records it. For use inside a transaction. */
function stop(deps: FinanceDeps, actorId: Id | null, entry: TimeEntry): TimeEntry | null {
  const at = deps.clock();
  const stopped = stopEntry(entry, at);
  if (!stopped.ok) return null;
  deps.time.update(stopped.value, at);
  recordActivity(deps, { actorId, action: "time.stopped", recordType: "time-entry", recordId: entry.id, context: { projectId: entry.projectId, taskId: entry.taskId, minutes: stopped.value.minutes } });
  return stopped.value;
}

/** Stops the actor's own running timer. */
export function stopTimer(deps: FinanceDeps, actorId: Id | null): Result<TimeEntry, "forbidden" | "not-running"> {
  if (!allowed(deps, actorId, "time.log")) return err("forbidden");
  return deps.transact(() => {
    const running = deps.time.running(actorId);
    const stopped = running ? stop(deps, actorId, running) : null;
    return stopped ? ok(stopped) : err("not-running");
  });
}

/**
 * The timer's side of a task move (docs/workflow.md, B6). Marking a task
 * "working on" starts the mover's timer on it, stopping any other timer they
 * had running. Moving a task out of "working on" stops every timer running on
 * it. It has no transaction of its own: the projects module calls it inside
 * the move's. Someone who may not log time simply gets no timer.
 */
export function applyTaskMove(deps: FinanceDeps, actorId: Id, task: Task, from: string): void {
  // A to-do belongs to no project, so no time is kept on it.
  if (task.projectId === null) return;
  if (from === "doing" && task.status !== "doing") {
    for (const entry of deps.time.runningOnTask(task.id)) stop(deps, actorId, entry);
    return;
  }
  if (task.status !== "doing" || from === "doing" || !authorize(deps, actorId, "time.log").ok) return;
  const other = deps.time.running(actorId);
  if (other) stop(deps, actorId, other);
  const at = deps.clock();
  const entry = startEntry({ id: deps.newId(), projectId: task.projectId, taskId: task.id, userId: actorId }, at, deps.today());
  deps.time.insert(entry, at);
  recordActivity(deps, { actorId, action: "time.started", recordType: "time-entry", recordId: entry.id, context: { projectId: task.projectId, taskId: task.id } });
}

/** Removes a mistaken entry. Your own, or anyone's with `time.view-all`. */
export function removeTime(deps: FinanceDeps, actorId: Id | null, entryId: Id): Result<TimeEntry, Refused> {
  if (!allowed(deps, actorId, "time.log")) return err("forbidden");
  return deps.transact(() => {
    const entry = deps.time.get(entryId);
    if (!entry) return err("not-found");
    // Someone else's entry is "not found" to a person who may only see their own.
    if (entry.userId !== actorId && !authorize(deps, actorId, "time.view-all").ok) return err("not-found");
    deps.time.remove(entryId, deps.clock());
    recordActivity(deps, { actorId, action: "time.removed", recordType: "time-entry", recordId: entryId, context: { projectId: entry.projectId, minutes: entry.minutes, on: entry.workedOn, ownerId: entry.userId } });
    return ok(entry);
  });
}

export function addExpense(
  deps: FinanceDeps,
  actorId: Id | null,
  projectId: Id,
  input: ExpenseInput & { readonly receipt?: { readonly name: string; readonly bytes: Uint8Array } | null },
): Result<Expense, Refused | ExpenseError | UploadError> {
  if (!allowed(deps, actorId, "expense.edit")) return err("forbidden");
  return deps.transact(() => {
    const project = deps.projects.get(projectId);
    if (!project) return err("not-found");
    const id = deps.newId();
    // Check the words before storing the receipt, so a bad amount stores nothing.
    const draft = newExpense({ id, projectId, recordedBy: actorId, receiptFileId: null }, input, deps.today());
    if (!draft.ok) return draft;
    let receiptFileId: Id | null = null;
    if (input.receipt) {
      const file = saveFile(deps, actorId, { ...input.receipt, ownerType: "expense-receipt", ownerId: id, organizationId: project.organizationId, projectId });
      if (!file.ok) return file;
      receiptFileId = file.value.id;
    }
    const expense = { ...draft.value, receiptFileId };
    deps.expenses.insert(expense, deps.clock());
    recordActivity(deps, {
      actorId,
      action: "expense.added",
      recordType: "expense",
      recordId: id,
      context: { projectId, category: expense.category, minor: expense.amount.minor, currency: expense.amount.currency, on: expense.spentOn, hasReceipt: receiptFileId !== null },
    });
    return ok(expense);
  });
}

export function removeExpense(deps: FinanceDeps, actorId: Id | null, expenseId: Id): Result<Expense, Refused> {
  if (!allowed(deps, actorId, "expense.edit")) return err("forbidden");
  return deps.transact(() => {
    const expense = deps.expenses.get(expenseId);
    if (!expense) return err("not-found");
    deps.expenses.remove(expenseId, deps.clock());
    recordActivity(deps, { actorId, action: "expense.removed", recordType: "expense", recordId: expenseId, context: { projectId: expense.projectId, minor: expense.amount.minor } });
    return ok(expense);
  });
}

export function setProjectBudget(deps: FinanceDeps, actorId: Id | null, projectId: Id, input: BudgetInput): Result<ProjectFinance, Refused | BudgetError> {
  if (!allowed(deps, actorId, "finance.edit")) return err("forbidden");
  return deps.transact(() => {
    if (!deps.projects.get(projectId)) return err("not-found");
    const changed = setBudget(deps.finance.get(projectId) ?? defaultFinance(projectId), input);
    if (!changed.ok) return changed;
    deps.finance.save(changed.value, deps.clock());
    recordActivity(deps, {
      actorId,
      action: "project.budget-set",
      recordType: "project",
      recordId: projectId,
      context: { minor: changed.value.budget?.minor ?? null, minutes: changed.value.budgetMinutes, rateMinor: changed.value.rate.minor },
    });
    return ok(changed.value);
  });
}

export function setProjectPayment(deps: FinanceDeps, actorId: Id | null, projectId: Id, input: { readonly status: string; readonly invoiceRef?: string | null }): Result<ProjectFinance, Refused | "invalid-payment-status" | "invoice-ref-too-long"> {
  if (!allowed(deps, actorId, "finance.edit")) return err("forbidden");
  return deps.transact(() => {
    if (!deps.projects.get(projectId)) return err("not-found");
    const before = deps.finance.get(projectId) ?? defaultFinance(projectId);
    const changed = setPayment(before, input);
    if (!changed.ok) return changed;
    deps.finance.save(changed.value, deps.clock());
    recordActivity(deps, { actorId, action: "project.payment-status-changed", recordType: "project", recordId: projectId, context: { from: before.paymentStatus, to: changed.value.paymentStatus, invoiceRef: changed.value.invoiceRef } });
    return ok(changed.value);
  });
}

export function createInvoice(deps: FinanceDeps, actorId: Id | null, projectId: Id, input: InvoiceInput): Result<Invoice, Refused | InvoiceError> {
  if (!allowed(deps, actorId, "invoice.edit")) return err("forbidden");
  return deps.transact(() => {
    const project = deps.projects.get(projectId);
    if (!project) return err("not-found");
    const invoice = newInvoice({ id: deps.newId(), organizationId: project.organizationId, projectId, number: deps.invoices.nextNumber(), createdBy: actorId }, input);
    if (!invoice.ok) return invoice;
    deps.invoices.insert(invoice.value, deps.clock());
    recordActivity(deps, { actorId, action: "invoice.created", recordType: "invoice", recordId: invoice.value.id, context: { projectId, number: invoice.value.number, kind: invoice.value.kind, minor: invoice.value.total.minor } });
    return ok(invoice.value);
  });
}

/**
 * An invoice on a client with no project: a domain, a one-off charge. Its kind
 * is "full" or "other"; a deposit or a balance needs a project. `invoice.edit`.
 */
export function createClientInvoice(deps: FinanceDeps, actorId: Id | null, organizationId: Id, input: InvoiceInput, options: { readonly send?: boolean } = {}): Result<Invoice, Refused | InvoiceError> {
  if (!allowed(deps, actorId, "invoice.edit")) return err("forbidden");
  return deps.transact(() => {
    if (!deps.clients.get(organizationId)) return err("not-found");
    return clientInvoiceInside(deps, actorId, organizationId, input, options.send === true);
  });
}

/** Makes (and, if asked, sends) an invoice on a client alone, inside a transaction already open. */
function clientInvoiceInside(deps: FinanceDeps, actorId: Id, organizationId: Id, input: InvoiceInput, send: boolean): Result<Invoice, InvoiceError> {
  const invoice = newInvoice({ id: deps.newId(), organizationId, projectId: null, number: deps.invoices.nextNumber(), createdBy: actorId }, input);
  if (!invoice.ok) return invoice;
  deps.invoices.insert(invoice.value, deps.clock());
  recordActivity(deps, { actorId, action: "invoice.created", recordType: "invoice", recordId: invoice.value.id, context: { organizationId, number: invoice.value.number, kind: invoice.value.kind, minor: invoice.value.total.minor } });
  if (!send) return ok(invoice.value);
  // Drafted and sent in one step, for a small charge like a domain.
  const sent = sendInvoice(invoice.value, deps.today());
  if (!sent.ok) return ok(invoice.value);
  deps.invoices.update(sent.value, deps.clock());
  recordActivity(deps, { actorId, action: "invoice.sent", recordType: "invoice", recordId: sent.value.id, context: { organizationId, number: sent.value.number, minor: sent.value.total.minor } });
  return ok(sent.value);
}

/**
 * A client buys a block of prepaid hours. With a price, HQ makes its invoice
 * on the client too, a draft or sent. `invoice.edit`.
 */
export function addPrepaidHours(deps: FinanceDeps, actorId: Id | null, organizationId: Id, input: BlockInput & { readonly price?: string | null; readonly send?: boolean }): Result<PrepaidBlock, Refused | BlockError | InvoiceError> {
  if (!allowed(deps, actorId, "invoice.edit")) return err("forbidden");
  return deps.transact((): Result<PrepaidBlock, Refused | BlockError | InvoiceError> => {
    if (!deps.clients.get(organizationId)) return err("not-found");
    const checked = newBlock({ id: deps.newId(), organizationId, createdBy: actorId, invoiceId: null }, input);
    if (!checked.ok) return checked;
    const price = (input.price ?? "").trim();
    let invoiceId: Id | null = null;
    if (price !== "") {
      const hours = checked.value.minutes / 60;
      const made = clientInvoiceInside(deps, actorId, organizationId, { kind: "full", description: `${hours} prepaid hours`, amount: price }, input.send === true);
      if (!made.ok) return made;
      invoiceId = made.value.id;
    }
    const block = { ...checked.value, invoiceId };
    deps.billing.insertBlock(block, deps.clock());
    recordActivity(deps, { actorId, action: "prepaid-hours.added", recordType: "client", recordId: organizationId, context: { minutes: block.minutes, boughtOn: block.boughtOn, invoiceId } });
    return ok(block);
  });
}

/** How clients pay, in Potomac's words, for the portal. `invoice.edit`. */
export function setPayInstructions(deps: FinanceDeps, actorId: Id | null, text: string): Result<{ readonly text: string }, "forbidden" | "too-long" | "number-in-instructions"> {
  if (!allowed(deps, actorId, "invoice.edit")) return err("forbidden");
  const clean = text.trim().replace(/\r\n/g, "\n");
  if (clean.length > 2000) return err("too-long");
  // Shown to every client: never a card or account number.
  if (/(?:\d[ -]?){13,19}/.test(clean)) return err("number-in-instructions");
  return deps.transact(() => {
    deps.billing.setPayInstructions(clean, actorId, deps.clock());
    recordActivity(deps, { actorId, action: "finance.pay-instructions-set", recordType: "setting", recordId: "finance-setting" as Id, context: { length: clean.length } });
    return ok({ text: clean });
  });
}

/** Takes a credit off a draft invoice: a line with a negative amount (decision 0013, section 7). */
export function addCreditToInvoice(deps: FinanceDeps, actorId: Id | null, invoiceId: Id, input: { readonly description: string; readonly minor: number }): Result<Invoice, Refused | "not-a-draft" | "too-many-lines" | "description-missing" | "description-too-long" | "amount-must-be-positive" | "credit-too-large"> {
  if (!allowed(deps, actorId, "invoice.edit")) return err("forbidden");
  return deps.transact(() => {
    const invoice = deps.invoices.get(invoiceId);
    if (!invoice) return err("not-found");
    const changed = addCreditLine(invoice, input);
    if (!changed.ok) return changed;
    deps.invoices.update(changed.value, deps.clock());
    recordActivity(deps, { actorId, action: "invoice.credit-added", recordType: "invoice", recordId: invoiceId, context: { projectId: invoice.projectId, number: invoice.number, credit: input.minor, minor: changed.value.total.minor } });
    return ok(changed.value);
  });
}

export function addLineToInvoice(deps: FinanceDeps, actorId: Id | null, invoiceId: Id, input: { readonly description: string; readonly amount: string }): Result<Invoice, Refused | "not-a-draft" | "too-many-lines" | "description-missing" | "description-too-long" | "not-an-amount" | "amount-must-be-positive"> {
  if (!allowed(deps, actorId, "invoice.edit")) return err("forbidden");
  return deps.transact(() => {
    const invoice = deps.invoices.get(invoiceId);
    if (!invoice) return err("not-found");
    const changed = addInvoiceLine(invoice, input);
    if (!changed.ok) return changed;
    deps.invoices.update(changed.value, deps.clock());
    recordActivity(deps, { actorId, action: "invoice.line-added", recordType: "invoice", recordId: invoiceId, context: { projectId: invoice.projectId, number: invoice.number, minor: changed.value.total.minor } });
    return ok(changed.value);
  });
}

/**
 * Drafts the deposit invoice for a project whose proposal was just accepted,
 * so it is ready for Potomac to check and send (docs/workflow.md, B4). It is
 * only a draft: nothing reaches the client until someone sends it.
 *
 * Called from inside the acceptance's own transaction, by whoever recorded
 * it: Potomac, or the client in the portal (actor null). Whoever may record
 * an acceptance may cause this, so there is no second permission check. It
 * does nothing when there is no deposit, or the project already has a
 * deposit invoice that is not void.
 */
export function applyDepositDraft(deps: FinanceDeps, actorId: Id | null, accepted: { readonly projectId: Id; readonly ownerId: Id; readonly deposit: Money | null; readonly title: string; readonly version: number }): Invoice | null {
  if (!accepted.deposit || accepted.deposit.minor <= 0) return null;
  if (deps.invoices.listForProject(accepted.projectId).some((invoice) => invoice.kind === "deposit" && invoice.status !== "void")) return null;
  const project = deps.projects.get(accepted.projectId);
  if (!project) return null;
  const amount = (accepted.deposit.minor / 100).toFixed(2);
  const invoice = newInvoice(
    { id: deps.newId(), organizationId: project.organizationId, projectId: accepted.projectId, number: deps.invoices.nextNumber(), createdBy: actorId ?? accepted.ownerId },
    { kind: "deposit", description: `Deposit, one third of “${accepted.title}”`.slice(0, 200), amount, note: `Drafted by HQ when version ${accepted.version} of the proposal was accepted.` },
  );
  if (!invoice.ok) throw new Error(`Could not draft the deposit invoice: ${invoice.error}`);
  deps.invoices.insert(invoice.value, deps.clock());
  recordActivity(deps, { actorId, action: "invoice.drafted-from-proposal", recordType: "invoice", recordId: invoice.value.id, context: { projectId: accepted.projectId, number: invoice.value.number, kind: "deposit", minor: invoice.value.total.minor } });
  return invoice.value;
}

/** Moves the project's payment status on when one of its invoices changes, and records it. Inside a transaction. */
function followInvoice(deps: FinanceDeps, actorId: Id | null, changed: Invoice): void {
  // A charge on the client alone has no project to move on.
  const projectId = changed.projectId;
  if (projectId === null) return;
  const to = paymentStatusAfter(changed, deps.invoices.listForProject(projectId));
  const before = deps.finance.get(projectId) ?? defaultFinance(projectId);
  if (to === null || to === before.paymentStatus) return;
  deps.finance.save({ ...before, paymentStatus: to, invoiceRef: before.invoiceRef }, deps.clock());
  recordActivity(deps, { actorId, action: "project.payment-status-changed", recordType: "project", recordId: projectId, context: { from: before.paymentStatus, to, because: "invoice", invoiceNumber: changed.number } });
}

/** Sends a draft: it gets today's date and can no longer be edited. The project becomes "invoiced". */
export function sendInvoiceNow(deps: FinanceDeps, actorId: Id | null, invoiceId: Id): Result<Invoice, Refused | "not-a-draft"> {
  if (!allowed(deps, actorId, "invoice.edit")) return err("forbidden");
  return deps.transact(() => {
    const invoice = deps.invoices.get(invoiceId);
    if (!invoice) return err("not-found");
    const sent = sendInvoice(invoice, deps.today());
    if (!sent.ok) return sent;
    deps.invoices.update(sent.value, deps.clock());
    recordActivity(deps, { actorId, action: "invoice.sent", recordType: "invoice", recordId: invoiceId, context: { projectId: invoice.projectId, number: invoice.number, minor: sent.value.total.minor } });
    followInvoice(deps, actorId, sent.value);
    return ok(sent.value);
  });
}

export function voidInvoiceNow(deps: FinanceDeps, actorId: Id | null, invoiceId: Id): Result<Invoice, Refused | "already-void" | "already-paid" | "has-payments"> {
  if (!allowed(deps, actorId, "invoice.edit")) return err("forbidden");
  return deps.transact(() => {
    const invoice = deps.invoices.get(invoiceId);
    if (!invoice) return err("not-found");
    if (invoice.paidMinor > 0) return err("has-payments");
    const voided = voidInvoice(invoice);
    if (!voided.ok) return voided;
    deps.invoices.update(voided.value, deps.clock());
    recordActivity(deps, { actorId, action: "invoice.voided", recordType: "invoice", recordId: invoiceId, context: { projectId: invoice.projectId, number: invoice.number } });
    return ok(voided.value);
  });
}

/** One change to a sent invoice by Potomac, checked and logged. */
function changeInvoice<E extends string>(deps: FinanceDeps, actorId: Id | null, invoiceId: Id, action: string, change: (invoice: Invoice) => Result<Invoice, E>, context: (changed: Invoice) => Record<string, unknown>): Result<Invoice, Refused | E> {
  if (!allowed(deps, actorId, "invoice.edit")) return err("forbidden");
  return deps.transact(() => {
    const invoice = deps.invoices.get(invoiceId);
    if (!invoice) return err("not-found");
    const changed = change(invoice);
    if (!changed.ok) return changed;
    deps.invoices.update(changed.value, deps.clock());
    recordActivity(deps, { actorId, action, recordType: "invoice", recordId: invoiceId, context: { organizationId: invoice.organizationId, projectId: invoice.projectId, number: invoice.number, ...context(changed.value) } });
    return ok(changed.value);
  });
}

/** The client said when they'll pay: Today asks on that day if it's still owed. An empty day clears it. */
export const promiseInvoicePayment = (deps: FinanceDeps, actorId: Id | null, invoiceId: Id, input: { readonly on: string; readonly note?: string | null }): Result<Invoice, Refused | PromiseError> =>
  changeInvoice(deps, actorId, invoiceId, "invoice.promised", (invoice) => promisePayment(invoice, input), (changed) => ({ promisedOn: changed.promisedOn }));

/** A card payment link Potomac made itself; the portal shows "Pay by card". Empty clears it. */
export const setInvoicePayLink = (deps: FinanceDeps, actorId: Id | null, invoiceId: Id, link: string): Result<Invoice, Refused | PayLinkError> =>
  changeInvoice(deps, actorId, invoiceId, "invoice.pay-link-set", (invoice) => setPayLink(invoice, link), (changed) => ({ hasLink: changed.payLink !== null }));

/** Money that won't come: voided and marked written off, with why. */
export const writeOffInvoice = (deps: FinanceDeps, actorId: Id | null, invoiceId: Id, input: { readonly note: string }): Result<Invoice, Refused | WriteOffError> =>
  changeInvoice(deps, actorId, invoiceId, "invoice.written-off", (invoice) => writeOff(invoice, input, deps.today()), (changed) => ({ owedMinor: Math.max(0, changed.total.minor - (deps.invoices.get(changed.id)?.paidMinor ?? 0)) }));

/** Records money received against a sent invoice. When it is paid in full, the project's payment status follows. */
export function recordPayment(deps: FinanceDeps, actorId: Id | null, invoiceId: Id, input: PaymentInput): Result<{ invoice: Invoice; payment: Payment }, Refused | PaymentError> {
  if (!allowed(deps, actorId, "payment.record")) return err("forbidden");
  return deps.transact(() => {
    const invoice = deps.invoices.get(invoiceId);
    if (!invoice) return err("not-found");
    const received = receivePayment(invoice, invoice.paidMinor, { id: deps.newId(), recordedBy: actorId }, input, deps.today());
    if (!received.ok) return received;
    const at = deps.clock();
    deps.invoices.insertPayment(received.value.payment, at);
    if (received.value.invoice.status !== invoice.status) deps.invoices.update(received.value.invoice, at);
    recordActivity(deps, {
      actorId,
      action: "payment.recorded",
      recordType: "payment",
      recordId: received.value.payment.id,
      context: { projectId: invoice.projectId, invoiceId, number: invoice.number, minor: received.value.payment.amount.minor, method: received.value.payment.method, on: received.value.payment.receivedOn, paidInFull: received.value.invoice.status === "paid" },
    });
    followInvoice(deps, actorId, received.value.invoice);
    return ok(received.value);
  });
}

/**
 * A card payment the client made on the payment platform's own page (decision
 * 0018). Nobody in HQ recorded it, so the activity has no actor; the platform
 * said it was paid, which is the check. The payment row needs a person, so it
 * carries whoever made the invoice. `reference` is the platform's own, never
 * a card number.
 */
export function recordCardPayment(deps: FinanceDeps, invoiceId: Id, input: { readonly minor: number; readonly platform: string; readonly reference: string }): Result<{ invoice: Invoice; payment: Payment }, "not-found" | PaymentError> {
  return deps.transact(() => {
    const invoice = deps.invoices.get(invoiceId);
    if (!invoice) return err("not-found");
    const today = deps.today();
    const amount = (input.minor / 100).toFixed(2);
    const ids = { id: deps.newId(), recordedBy: invoice.createdBy };
    let received = receivePayment(invoice, invoice.paidMinor, ids, { amount, method: "card", on: today, reference: `${input.platform} ${input.reference}`.trim().slice(0, 100) }, today);
    // A platform's reference that happens to read like a card number is left out, not refused.
    if (!received.ok && received.error === "looks-like-a-card-number") received = receivePayment(invoice, invoice.paidMinor, ids, { amount, method: "card", on: today, reference: input.platform }, today);
    if (!received.ok) return received;
    const at = deps.clock();
    deps.invoices.insertPayment(received.value.payment, at);
    if (received.value.invoice.status !== invoice.status) deps.invoices.update(received.value.invoice, at);
    recordActivity(deps, {
      actorId: null,
      action: "payment.paid-by-card",
      recordType: "payment",
      recordId: received.value.payment.id,
      context: { projectId: invoice.projectId, invoiceId, number: invoice.number, minor: received.value.payment.amount.minor, method: "card", on: received.value.payment.receivedOn, paidInFull: received.value.invoice.status === "paid", by: "client", platform: input.platform },
    });
    followInvoice(deps, null, received.value.invoice);
    return ok(received.value);
  });
}

// ── Recurring invoices ────────────────────────────────────────────────────

/** Sets up a charge that repeats on a project. Permission: `invoice.edit`. */
export function addRecurringInvoice(deps: FinanceDeps, actorId: Id | null, projectId: Id, input: RecurringInput): Result<RecurringInvoice, Refused | RecurringError> {
  if (!allowed(deps, actorId, "invoice.edit")) return err("forbidden");
  return deps.transact(() => {
    const project = deps.projects.get(projectId);
    if (!project) return err("not-found");
    const made = newRecurring({ id: deps.newId(), organizationId: project.organizationId, projectId, createdBy: actorId }, input);
    if (!made.ok) return made;
    deps.recurring.insert(made.value, deps.clock());
    recordActivity(deps, { actorId, action: "recurring-invoice.added", recordType: "recurring-invoice", recordId: made.value.id, context: { projectId, every: made.value.every, minor: made.value.amount.minor, autoSend: made.value.autoSend } });
    return ok(made.value);
  });
}

/** A recurring invoice on a client with no project: hosting, upkeep, a plan. `invoice.edit`. */
export function addClientRecurringInvoice(deps: FinanceDeps, actorId: Id | null, organizationId: Id, input: RecurringInput): Result<RecurringInvoice, Refused | RecurringError> {
  if (!allowed(deps, actorId, "invoice.edit")) return err("forbidden");
  return deps.transact(() => {
    if (!deps.clients.get(organizationId)) return err("not-found");
    const made = newRecurring({ id: deps.newId(), organizationId, projectId: null, createdBy: actorId }, input);
    if (!made.ok) return made;
    deps.recurring.insert(made.value, deps.clock());
    recordActivity(deps, { actorId, action: "recurring-invoice.added", recordType: "recurring-invoice", recordId: made.value.id, context: { organizationId, every: made.value.every, minor: made.value.amount.minor, autoSend: made.value.autoSend } });
    return ok(made.value);
  });
}

/** Pauses one, or starts it again. A paused one makes nothing; started again, it picks up from its next day, or today. */
export function setRecurringActive(deps: FinanceDeps, actorId: Id | null, id: Id, active: boolean): Result<RecurringInvoice, Refused> {
  if (!allowed(deps, actorId, "invoice.edit")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.recurring.get(id);
    if (!found) return err("not-found");
    // Started again after a long pause: no back-billing for the paused months.
    let nextOn = found.nextOn;
    while (active && !found.active && nextOn < deps.today()) nextOn = nextAfter(nextOn, found.every, found.anchorDay);
    const changed = { ...found, active, nextOn };
    deps.recurring.update(changed, deps.clock());
    recordActivity(deps, { actorId, action: active ? "recurring-invoice.resumed" : "recurring-invoice.paused", recordType: "recurring-invoice", recordId: id, context: { projectId: found.projectId } });
    return ok(changed);
  });
}

/**
 * Makes every invoice whose day has come: one per period, up to a year of
 * missed ones, each a draft or sent as the recurring invoice says. Run by
 * HQ itself each morning, so the actor is HQ (null). Safe to run twice: each
 * invoice moves its recurring invoice on in the same transaction.
 */
export function runRecurringInvoices(deps: FinanceDeps): { readonly made: number; readonly sent: number } {
  let made = 0;
  let sent = 0;
  const today = deps.today();
  for (const first of deps.recurring.due(today)) {
    for (let n = 0; n < 12; n++) {
      const done = deps.transact(() => {
        const recurring = deps.recurring.get(first.id);
        if (!recurring || !isDue(recurring, today)) return null;
        // One on a project needs it still there; one on the client alone needs the client.
        if (recurring.projectId !== null ? !deps.projects.get(recurring.projectId) : !deps.clients.get(recurring.organizationId)) return null;
        const dueOn = recurring.autoSend ? Temporal.PlainDate.from(today).add({ days: recurring.dueDays }).toString() : null;
        const invoice = newInvoice(
          { id: deps.newId(), organizationId: recurring.organizationId, projectId: recurring.projectId, number: deps.invoices.nextNumber(), createdBy: recurring.createdBy },
          { kind: "other", description: periodLine(recurring, recurring.nextOn), amount: (recurring.amount.minor / 100).toFixed(2), dueOn, note: "Made by HQ from a recurring invoice." },
        );
        if (!invoice.ok) throw new Error(`Could not make a recurring invoice: ${invoice.error}`);
        deps.invoices.insert(invoice.value, deps.clock());
        deps.recurring.markInvoice(invoice.value.id, recurring.id);
        recordActivity(deps, { actorId: null, action: "invoice.created", recordType: "invoice", recordId: invoice.value.id, context: { projectId: recurring.projectId, number: invoice.value.number, kind: "other", minor: invoice.value.total.minor, recurringId: recurring.id } });
        let wasSent = false;
        if (recurring.autoSend) {
          const out = sendInvoice(invoice.value, today);
          if (out.ok) {
            deps.invoices.update(out.value, deps.clock());
            recordActivity(deps, { actorId: null, action: "invoice.sent", recordType: "invoice", recordId: out.value.id, context: { projectId: recurring.projectId, number: out.value.number, minor: out.value.total.minor } });
            followInvoice(deps, null, out.value);
            wasSent = true;
          }
        }
        deps.recurring.update({ ...recurring, nextOn: nextAfter(recurring.nextOn, recurring.every, recurring.anchorDay) }, deps.clock());
        return { wasSent };
      });
      if (!done) break;
      made++;
      if (done.wasSent) sent++;
    }
  }
  return { made, sent };
}

/**
 * Marks several draft invoices sent at once (quality of life, 2026-11-25),
 * each through sendInvoiceNow with its own checks and event. Only drafts of
 * the one project, and only once the person says they've checked them.
 */
export function sendInvoicesNow(deps: FinanceDeps, actorId: Id | null, projectId: Id, invoiceIds: readonly string[], checked: boolean): Result<{ readonly sent: number; readonly skipped: number }, "forbidden" | "nothing-picked" | "not-checked"> {
  if (!allowed(deps, actorId, "invoice.edit")) return err("forbidden");
  const ids = [...new Set(invoiceIds)].slice(0, 50) as Id[];
  if (ids.length === 0) return err("nothing-picked");
  if (!checked) return err("not-checked");
  let sent = 0;
  let skipped = 0;
  for (const id of ids) {
    const invoice = deps.invoices.get(id);
    const done = invoice && invoice.projectId === projectId ? sendInvoiceNow(deps, actorId, id) : null;
    if (done?.ok) sent += 1;
    else skipped += 1;
  }
  return ok({ sent, skipped });
}
