// Money spent on a project: a category, an amount, a day, and a receipt if
// there is one (roadmap v0.5).
import { calendarDate, optionalText } from "../../shared/domain/fields.ts";
import type { Id } from "../../shared/domain/id.ts";
import { parseAmount, type Money } from "../../shared/domain/money.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const EXPENSE_CATEGORIES = ["software", "hosting", "domain", "contractor", "hardware", "travel", "supplies", "training", "licenses", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type Expense = {
  readonly id: Id;
  readonly projectId: Id;
  readonly category: ExpenseCategory;
  readonly amount: Money;
  /** YYYY-MM-DD. */
  readonly spentOn: string;
  readonly note: string;
  readonly receiptFileId: Id | null;
  readonly recordedBy: Id;
};

export type ExpenseInput = { readonly category: string; readonly amount: string; readonly on: string; readonly note?: string | null };
export type ExpenseError = "invalid-category" | "not-an-amount" | "amount-must-be-positive" | "invalid-date" | "date-in-future" | "note-too-long";

export function newExpense(ids: { readonly id: Id; readonly projectId: Id; readonly recordedBy: Id; readonly receiptFileId: Id | null }, input: ExpenseInput, today: string): Result<Expense, ExpenseError> {
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(input.category)) return err("invalid-category");
  const amount = parseAmount(input.amount, "USD");
  if (!amount.ok) return err("not-an-amount");
  if (amount.value.minor <= 0) return err("amount-must-be-positive");
  const on = calendarDate(input.on.trim());
  if (!on.ok) return on;
  if (on.value > today) return err("date-in-future");
  const note = optionalText(input.note, 500);
  if (!note.ok) return err("note-too-long");
  return ok({ ...ids, category: input.category as ExpenseCategory, amount: amount.value, spentOn: on.value, note: note.value ?? "" });
}
