import type { ProjectFinance } from "../domain/budget.ts";
import type { Expense } from "../domain/expense.ts";
import type { Invoice, Payment } from "../domain/invoice.ts";
import type { RecurringInvoice } from "../domain/recurring.ts";
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

export type InvoiceRow = Invoice & { readonly projectName: string; readonly clientName: string; readonly organizationId: Id; readonly paidMinor: number };

export type InvoiceStore = {
  /** The number the next invoice takes: one more than the highest so far. */
  nextNumber(): number;
  insert(invoice: Invoice, at: string): void;
  update(invoice: Invoice, at: string): void;
  get(id: Id): InvoiceRow | null;
  /** A project's invoices, newest first. */
  listForProject(projectId: Id): InvoiceRow[];
  /** Every invoice, oldest first. */
  list(): InvoiceRow[];
  insertPayment(payment: Payment, at: string): void;
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
  /** Active ones whose next day has come. */
  due(today: string): RecurringInvoice[];
  /** Marks an invoice as made by a recurring invoice. */
  markInvoice(invoiceId: Id, recurringId: Id): void;
};
