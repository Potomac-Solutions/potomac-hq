import type { ProjectFinance } from "../domain/budget.ts";
import type { Expense } from "../domain/expense.ts";
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
