// A recurring invoice: the same charge on a project every month, quarter or
// year, such as hosting, maintenance or a retainer. On its day HQ makes the
// invoice, as a draft to check or sent straight away.
import { calendarDate, optionalText, requiredText } from "../../shared/domain/fields.ts";
import type { Id } from "../../shared/domain/id.ts";
import { parseAmount, type Money } from "../../shared/domain/money.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const EVERY = ["month", "quarter", "year"] as const;
export type Every = (typeof EVERY)[number];
export const EVERY_LABELS: Readonly<Record<Every, string>> = { month: "Every month", quarter: "Every three months", year: "Every year" };
const MONTHS: Readonly<Record<Every, number>> = { month: 1, quarter: 3, year: 12 };

export type RecurringInvoice = {
  readonly id: Id;
  readonly projectId: Id;
  readonly description: string;
  readonly amount: Money;
  readonly every: Every;
  /** The day of the month it falls on, 1 to 31. In a shorter month, its last day. */
  readonly anchorDay: number;
  /** The next day an invoice is made. */
  readonly nextOn: string;
  /** No invoice after this day. Null: until it is stopped. */
  readonly endsOn: string | null;
  /** Sent the day it is made. Otherwise it waits as a draft. */
  readonly autoSend: boolean;
  /** Days after it is sent that it is due. */
  readonly dueDays: number;
  readonly active: boolean;
  readonly createdBy: Id;
};

export type RecurringInput = { readonly description: string; readonly amount: string; readonly every: string; readonly firstOn: string; readonly endsOn?: string | null; readonly autoSend?: boolean; readonly dueDays?: string | null };
export type RecurringError = "description-missing" | "description-too-long" | "not-an-amount" | "amount-must-be-positive" | "invalid-every" | "invalid-date" | "ends-before-start" | "invalid-due-days";

export function newRecurring(ids: { readonly id: Id; readonly projectId: Id; readonly createdBy: Id }, input: RecurringInput): Result<RecurringInvoice, RecurringError> {
  const description = requiredText(input.description, 200);
  if (!description.ok) return err(description.error === "missing" ? "description-missing" : "description-too-long");
  const amount = parseAmount(input.amount, "USD");
  if (!amount.ok) return err("not-an-amount");
  if (amount.value.minor <= 0) return err("amount-must-be-positive");
  if (!(EVERY as readonly string[]).includes(input.every)) return err("invalid-every");
  const first = calendarDate(input.firstOn.trim());
  if (!first.ok) return err("invalid-date");
  const ends = optionalText(input.endsOn, 10);
  if (!ends.ok) return err("invalid-date");
  const endsOn = ends.value ? calendarDate(ends.value) : ok(null);
  if (!endsOn.ok) return err("invalid-date");
  if (endsOn.value !== null && endsOn.value < first.value) return err("ends-before-start");
  const dueText = (input.dueDays ?? "").trim();
  const dueDays = dueText === "" ? 15 : /^\d{1,2}$/.test(dueText) ? Number(dueText) : Number.NaN;
  if (!Number.isInteger(dueDays) || dueDays > 90) return err("invalid-due-days");
  return ok({
    ...ids,
    description: description.value,
    amount: amount.value,
    every: input.every as Every,
    anchorDay: Temporal.PlainDate.from(first.value).day,
    nextOn: first.value,
    endsOn: endsOn.value,
    autoSend: input.autoSend === true,
    dueDays,
    active: true,
  });
}

/** The day after `on`, one period on, on the anchor day or the month's last. Jan 31 monthly → Feb 28 → Mar 31. */
export function nextAfter(on: string, every: Every, anchorDay: number): string {
  const month = Temporal.PlainDate.from(on).toPlainYearMonth().add({ months: MONTHS[every] });
  return month.toPlainDate({ day: Math.min(anchorDay, month.daysInMonth) }).toString();
}

/** Whether an invoice is due to be made today. */
export const isDue = (recurring: RecurringInvoice, today: string): boolean => recurring.active && recurring.nextOn <= today && (recurring.endsOn === null || recurring.nextOn <= recurring.endsOn);

/** "Hosting, December 2026" or "Retainer, Q1 2027" or "Domain renewal, 2027": the line on the invoice for the period starting `on`. */
export function periodLine(recurring: RecurringInvoice, on: string): string {
  const date = Temporal.PlainDate.from(on);
  const period =
    recurring.every === "month"
      ? date.toLocaleString("en-US", { month: "long", year: "numeric" })
      : recurring.every === "quarter"
        ? `${date.toLocaleString("en-US", { month: "short" })} to ${date.add({ months: 2 }).toLocaleString("en-US", { month: "short", year: "numeric" })}`
        : `${date.toLocaleString("en-US", { month: "short", year: "numeric" })} to ${date.add({ months: 11 }).toLocaleString("en-US", { month: "short", year: "numeric" })}`;
  return `${recurring.description}, ${period}`;
}

/** What it brings in a month, in cents: a quarter's charge counts a third, a year's a twelfth. */
export const monthlyMinor = (recurring: RecurringInvoice): number => Math.round(recurring.amount.minor / MONTHS[recurring.every]);
