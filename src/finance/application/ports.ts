import type { PrepaidBlock } from "../domain/prepaid.ts";
import type { ChangeRequest } from "../domain/change-request.ts";
import type { ProjectFinance } from "../domain/budget.ts";
import type { Expense } from "../domain/expense.ts";
import type { Invoice, Payment, Refund } from "../domain/invoice.ts";
import type { RecurringInvoice } from "../domain/recurring.ts";
import type { ReminderKind } from "../domain/reminders.ts";
import type { TimeEntry } from "../domain/time.ts";
import type { Id } from "../../shared/index.ts";

export type TimeRow = TimeEntry & { readonly projectName: string; readonly taskTitle: string | null; readonly userName: string; readonly clientName: string };

export type TimeStore = {
  insert(entry: TimeEntry, at: string): void;
  update(entry: TimeEntry, at: string): void;
  get(id: Id): TimeEntry | null;
  /** Marks an entry removed. It stays in the table and leaves every list and total. */
  remove(id: Id, at: string): void;
  /** The person's running timer, or null. */
  running(userId: Id): TimeRow | null;
  /** Every running timer on a task. */
  runningOnTask(taskId: Id): TimeEntry[];
  /** Entries on days from..to, newest first. For one person, or everyone when `userId` is null. */
  list(range: { readonly from: string; readonly to: string }, userId: Id | null): TimeRow[];
  listForProject(projectId: Id, limit: number): TimeRow[];
  /** A project's finished minutes on days from..to. */
  totals(projectId: Id, range: { readonly from: string; readonly to: string }): { readonly minutes: number; readonly billableMinutes: number };
  /** The same, split by the phase of the task each entry is on. A null phase is time on no task, or on a task with no phase. */
  totalsByPhase(projectId: Id, range: { readonly from: string; readonly to: string }): { readonly phaseId: Id | null; readonly minutes: number }[];
  minutesOnTask(taskId: Id): number;
};

export type ExpenseRow = Expense & { readonly projectName: string; readonly clientName: string; readonly receiptName: string | null; readonly recordedByName: string };

export type ExpenseStore = {
  insert(expense: Expense, at: string): void;
  get(id: Id): Expense | null;
  remove(id: Id, at: string): void;
  listForProject(projectId: Id): ExpenseRow[];
  list(range: { readonly from: string; readonly to: string }): ExpenseRow[];
  /** A project's expenses on days from..to, in cents. */
  total(projectId: Id, range: { readonly from: string; readonly to: string }): number;
};

export type FinanceStore = {
  get(projectId: Id): ProjectFinance | null;
  save(finance: ProjectFinance, at: string): void;
};

/** Each phase's estimate: its tasks' estimates added up. */
export type PhaseEstimates = {
  forProject(projectId: Id): { readonly phaseId: Id | null; readonly minutes: number }[];
};

/** An invoice with its client's and project's names. `projectName` is "" for a charge on the client alone. */
export type InvoiceRow = Invoice & { readonly projectName: string; readonly clientName: string; readonly paidMinor: number };

export type InvoiceStore = {
  /** The number the next invoice takes: one more than the highest so far. */
  nextNumber(): number;
  insert(invoice: Invoice, at: string): void;
  update(invoice: Invoice, at: string): void;
  get(id: Id): InvoiceRow | null;
  /** A project's invoices, newest first. */
  listForProject(projectId: Id): InvoiceRow[];
  /** Every invoice to a client, on a project or not, newest first. */
  listForClient(organizationId: Id): InvoiceRow[];
  /** Every invoice, oldest first. */
  list(): InvoiceRow[];
  insertPayment(payment: Payment, at: string): void;
  payment(id: Id): Payment | null;
  insertRefund(refund: Refund, at: string): void;
  /** The refunds on an invoice's payments, oldest first. */
  refunds(invoiceId: Id): Refund[];
  /** An invoice's payments, oldest first. */
  payments(invoiceId: Id): Payment[];
  /** Every payment with its invoice's number and names, oldest first. */
  allPayments(): (Payment & { readonly number: number; readonly projectName: string; readonly clientName: string })[];
};

export type RecurringStore = {
  insert(recurring: RecurringInvoice, at: string): void;
  update(recurring: RecurringInvoice, at: string): void;
  get(id: Id): RecurringInvoice | null;
  /** A project's, active first, then by next day. */
  listForProject(projectId: Id): RecurringInvoice[];
  /** Every active one, by next day. */
  listActive(): RecurringInvoice[];
  /** A client's with no project, active first. */
  listForClientAlone(organizationId: Id): RecurringInvoice[];
  /** Active ones whose next day has come. */
  due(today: string): RecurringInvoice[];
  /** Marks an invoice as made by a recurring invoice. */
  markInvoice(invoiceId: Id, recurringId: Id): void;
};

export type ReminderStore = {
  /** Whether clients are emailed about invoices coming due and overdue. */
  on(): boolean;
  setOn(on: boolean, by: Id, at: string): void;
  sent(invoiceId: Id): { readonly kind: ReminderKind; readonly sentAt: string; readonly sentTo: string }[];
  record(invoiceId: Id, kind: ReminderKind, at: string, to: string): void;
  isOff(invoiceId: Id): boolean;
  setOff(invoiceId: Id, off: boolean, by: Id, at: string): void;
};

/** Who at a client gets their invoices: the primary contact with an email, or else their portal users. */
export type ClientEmails = (organizationId: Id) => readonly { readonly name: string; readonly email: string; readonly portal: boolean }[];

export type ChangeRequestStore = {
  /** The number the next change on this project takes. */
  nextNumber(projectId: Id): number;
  insert(change: ChangeRequest, at: string): void;
  update(change: ChangeRequest, at: string): void;
  get(id: Id): ChangeRequest | null;
  /** A project's changes, newest first. */
  listFor(projectId: Id): ChangeRequest[];
};

/** Billing extras (decision 0017, third part): how clients pay, prepaid hours, receipts and statements sent. */
export type BillingStore = {
  /** How clients pay, in Potomac's words, for the portal. "" until set. */
  payInstructions(): string;
  setPayInstructions(text: string, by: Id, at: string): void;
  insertBlock(block: PrepaidBlock, at: string): void;
  blocksFor(organizationId: Id): PrepaidBlock[];
  /** Clients with any prepaid block. */
  clientsWithBlocks(): Id[];
  /** Minutes logged on a client's projects on or after a day, removed entries left out. */
  minutesSince(organizationId: Id, since: string): number;
  /** Payments recorded at or after a moment with no receipt sent yet, oldest first. */
  paymentsWithoutReceipt(since: string): { readonly payment: Payment; readonly invoiceId: Id }[];
  markReceipt(paymentId: Id, at: string, sentTo: string): void;
  statementSent(organizationId: Id, month: string): boolean;
  markStatement(organizationId: Id, month: string, at: string, sentTo: string): void;
  /** A client's payments received in a year, by day. */
  paymentsForClient(organizationId: Id, year: number): { readonly payment: Payment; readonly invoiceNumber: number; readonly projectName: string; readonly forWhat: string }[];
};
