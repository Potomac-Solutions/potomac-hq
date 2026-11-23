// A project's budget and how the work is tracking against it (roadmap v0.5).
// This is a management view. It is not the book of record: revenue and
// margin here are operational estimates.
import { parseHours } from "../../shared/domain/hours.ts";
import type { Id } from "../../shared/domain/id.ts";
import { parseAmount, type Money } from "../../shared/domain/money.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const PAYMENT_STATUSES = ["not-invoiced", "deposit-paid", "invoiced", "paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** What an hour of work is counted as costing, until a project says otherwise: the consulting rate. */
export const DEFAULT_RATE_MINOR = 7500;

export type ProjectFinance = {
  readonly projectId: Id;
  /** Set by hand. Null means "use the accepted proposal's". */
  readonly budget: Money | null;
  readonly budgetMinutes: number | null;
  /** What an hour of work on this project is counted as costing. */
  readonly rate: Money;
  readonly paymentStatus: PaymentStatus;
  /** The invoice's number or link in the tool that sent it. */
  readonly invoiceRef: string;
};

export function defaultFinance(projectId: Id): ProjectFinance {
  return { projectId, budget: null, budgetMinutes: null, rate: { minor: DEFAULT_RATE_MINOR, currency: "USD" }, paymentStatus: "not-invoiced", invoiceRef: "" };
}

export type BudgetInput = { readonly amount: string; readonly hours: string; readonly rate: string };
export type BudgetError = "not-an-amount" | "invalid-hours" | "rate-must-be-positive";

/** An empty amount or hours means "go back to the accepted proposal's". */
export function setBudget(finance: ProjectFinance, input: BudgetInput): Result<ProjectFinance, BudgetError> {
  const amount = input.amount.trim() === "" ? ok(null) : parseAmount(input.amount, "USD");
  if (!amount.ok) return err("not-an-amount");
  const minutes = parseHours(input.hours);
  if (!minutes.ok) return minutes;
  const rate = parseAmount(input.rate.trim() === "" ? (DEFAULT_RATE_MINOR / 100).toFixed(2) : input.rate, "USD");
  if (!rate.ok) return err("not-an-amount");
  if (rate.value.minor <= 0) return err("rate-must-be-positive");
  return ok({ ...finance, budget: amount.value, budgetMinutes: minutes.value, rate: rate.value });
}

export function setPayment(finance: ProjectFinance, input: { readonly status: string; readonly invoiceRef?: string | null }): Result<ProjectFinance, "invalid-payment-status" | "invoice-ref-too-long"> {
  if (!(PAYMENT_STATUSES as readonly string[]).includes(input.status)) return err("invalid-payment-status");
  const ref = (input.invoiceRef ?? "").trim();
  if (ref.length > 200) return err("invoice-ref-too-long");
  return ok({ ...finance, paymentStatus: input.status as PaymentStatus, invoiceRef: ref });
}

export type Budget = { readonly amount: Money | null; readonly minutes: number | null };
export type Actuals = { readonly minutes: number; readonly billableMinutes: number; readonly expenses: Money };

export type Standing = {
  /** What the time is counted as costing: hours × rate. */
  readonly timeCost: Money;
  /** Time plus expenses. */
  readonly cost: Money;
  /** The budget amount less the cost. Null when there is no budget amount. */
  readonly margin: Money | null;
  /** The margin as a whole percentage of the budget. Null when there is none, or the budget is zero. */
  readonly marginPercent: number | null;
  readonly overHours: boolean;
  readonly overCost: boolean;
  /** Either of the two. */
  readonly over: boolean;
};

/** Estimate against actual. Something with no budget is never "over". */
export function standing(budget: Budget, actual: Actuals, rate: Money): Standing {
  const timeCost = { minor: Math.round((actual.minutes * rate.minor) / 60), currency: rate.currency };
  const cost = { minor: timeCost.minor + actual.expenses.minor, currency: rate.currency };
  const margin = budget.amount === null ? null : { minor: budget.amount.minor - cost.minor, currency: budget.amount.currency };
  const overHours = budget.minutes !== null && actual.minutes > budget.minutes;
  const overCost = budget.amount !== null && cost.minor > budget.amount.minor;
  return {
    timeCost,
    cost,
    margin,
    marginPercent: margin === null || budget.amount === null || budget.amount.minor === 0 ? null : Math.round((margin.minor / budget.amount.minor) * 100),
    overHours,
    overCost,
    over: overHours || overCost,
  };
}

/**
 * The stretch of days a budget covers, given today. A one-time job is
 * measured over all time. A monthly plan is measured over this month, a
 * yearly one over this year, because their price is for one period.
 */
export function budgetPeriod(pricing: string | null, today: string): { readonly from: string; readonly to: string; readonly label: string } {
  const day = Temporal.PlainDate.from(today);
  if (pricing === "monthly") return { from: day.with({ day: 1 }).toString(), to: day.with({ day: day.daysInMonth }).toString(), label: "this month" };
  if (pricing === "yearly") return { from: day.with({ month: 1, day: 1 }).toString(), to: day.with({ month: 12, day: 31 }).toString(), label: "this year" };
  return { from: "0000-01-01", to: "9999-12-31", label: "so far" };
}

/** Share of a budget used before a project is worth watching. */
export const WATCH_AT_PERCENT = 75;

export type BudgetWarning = {
  readonly level: "over" | "watch";
  /** Like "78% of hours used, 2 of 6 milestones done". */
  readonly text: string;
};

/**
 * Over, or worth watching: three quarters or more of the hours or the money
 * used while less of the work is done. "Done" is the share of milestones
 * finished; with no milestones, or for a monthly or yearly plan, using three
 * quarters is enough. Null when it is fine or has no budget.
 */
export function budgetWarning(budget: Budget, actual: { readonly minutes: number }, s: Standing, done: { readonly done: number; readonly total: number } | null): BudgetWarning | null {
  const hoursUsed = budget.minutes !== null && budget.minutes > 0 ? Math.round((actual.minutes / budget.minutes) * 100) : null;
  const moneyUsed = budget.amount !== null && budget.amount.minor > 0 ? Math.round((s.cost.minor / budget.amount.minor) * 100) : null;
  const used = Math.max(hoursUsed ?? -1, moneyUsed ?? -1);
  if (used < 0) return null;
  const what = (hoursUsed ?? -1) >= (moneyUsed ?? -1) ? `${hoursUsed}% of hours used` : `${moneyUsed}% of the budget used`;
  const work = done && done.total > 0 ? `, ${done.done} of ${done.total} milestones done` : "";
  if (s.over) return { level: "over", text: `${what}${work}` };
  if (used < WATCH_AT_PERCENT) return null;
  if (done && done.total > 0 && (done.done / done.total) * 100 >= used) return null;
  return { level: "watch", text: `${what}${work}` };
}
