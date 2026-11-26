// Late fees (2026-11-26). Off until set. Once per invoice, never on a late
// fee, never compounding: a percent is of what was still owed that day.
import { err, ok, type Result } from "../../shared/domain/result.ts";
import { parseAmount } from "../../shared/domain/money.ts";

export type LateFeeSetting = { readonly kind: "off" | "percent" | "flat"; readonly amount: number; readonly afterDays: number };
export const LATE_FEES_OFF: LateFeeSetting = { kind: "off", amount: 0, afterDays: 30 };

/** Days late before someone is asked to call. The two-week reminder email asks the client to call too. */
export const CALL_AFTER_DAYS = 14;

export type LateFeeInvoice = { readonly status: string; readonly dueOn: string | null; readonly owedMinor: number; readonly isFee: boolean; readonly charged: boolean };

export function daysLate(dueOn: string, today: string): number {
  return Temporal.PlainDate.from(today).since(dueOn).days;
}

/** The fee an invoice is due today, in cents, or null. */
export function lateFeeDue(setting: LateFeeSetting, invoice: LateFeeInvoice, today: string): number | null {
  if (setting.kind === "off" || invoice.status !== "sent" || invoice.dueOn === null || invoice.owedMinor <= 0 || invoice.isFee || invoice.charged) return null;
  if (daysLate(invoice.dueOn, today) < setting.afterDays) return null;
  const fee = setting.kind === "flat" ? setting.amount : Math.round((invoice.owedMinor * setting.amount) / 10_000);
  return fee >= 1 ? fee : null;
}

export type LateFeeError = "invalid-late-fee-kind" | "invalid-late-fee-amount" | "invalid-late-fee-days";

/** Reads the form: a percent like "1.5", or dollars like "25". */
export function readLateFee(input: { readonly kind: string; readonly amount?: string | null; readonly afterDays?: string | null }): Result<LateFeeSetting, LateFeeError> {
  if (input.kind === "off") return ok({ ...LATE_FEES_OFF, afterDays: Number(input.afterDays) || LATE_FEES_OFF.afterDays });
  if (input.kind !== "percent" && input.kind !== "flat") return err("invalid-late-fee-kind");
  const days = Number((input.afterDays ?? "").trim());
  if (!Number.isInteger(days) || days < 1 || days > 120) return err("invalid-late-fee-days");
  const text = (input.amount ?? "").trim().replace(/%$/, "");
  if (input.kind === "percent") {
    const percent = Number(text);
    if (!/^\d+(\.\d{1,2})?$/.test(text) || percent <= 0 || percent > 10) return err("invalid-late-fee-amount");
    return ok({ kind: "percent", amount: Math.round(percent * 100), afterDays: days });
  }
  const amount = parseAmount(text, "USD");
  if (!amount.ok || amount.value.minor <= 0 || amount.value.minor > 100_000) return err("invalid-late-fee-amount");
  return ok({ kind: "flat", amount: amount.value.minor, afterDays: days });
}

export function lateFeeWords(setting: LateFeeSetting): string {
  if (setting.kind === "off") return "Off";
  const what = setting.kind === "flat" ? `$${(setting.amount / 100).toFixed(2)}` : `${(setting.amount / 100).toString()}% of what’s still owed`;
  return `${what}, once, when an invoice is ${setting.afterDays} days late`;
}
