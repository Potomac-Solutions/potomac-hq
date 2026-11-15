// Money is a whole number of minor units (cents) plus a currency code
// (docs/data-model.md). Never a floating-point amount.
import { err, ok, type Result } from "./result.ts";

export const CURRENCIES = ["USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export type Money = { readonly minor: number; readonly currency: Currency };

export type MoneyError = "not-whole-minor-units" | "unknown-currency";

export function money(minor: number, currency: string): Result<Money, MoneyError> {
  if (!Number.isSafeInteger(minor)) return err("not-whole-minor-units");
  if (!isCurrency(currency)) return err("unknown-currency");
  return ok({ minor, currency });
}

export function isCurrency(code: string): code is Currency {
  return (CURRENCIES as readonly string[]).includes(code);
}

export function addMoney(
  a: Money,
  b: Money,
): Result<Money, "currency-mismatch" | "not-whole-minor-units"> {
  if (a.currency !== b.currency) return err("currency-mismatch");
  const minor = a.minor + b.minor;
  if (!Number.isSafeInteger(minor)) return err("not-whole-minor-units");
  return ok({ minor, currency: a.currency });
}

export function sameMoney(a: Money, b: Money): boolean {
  return a.minor === b.minor && a.currency === b.currency;
}

/**
 * Reads an amount as people type it: "1250", "1,250.00", "$75.5". Whole
 * dollars and cents only, never negative.
 */
export function parseAmount(text: string, currency: string): Result<Money, MoneyError | "not-an-amount"> {
  const cleaned = text.trim().replace(/^\$/, "").trim();
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(cleaned)) return err("not-an-amount");
  const [whole = "0", cents = ""] = cleaned.replace(/,/g, "").split(".");
  return money(Number(whole) * 100 + Number(cents.padEnd(2, "0")), currency);
}

/** "$1,250.00" */
export function formatMoney(value: Money): string {
  const sign = value.minor < 0 ? "-" : "";
  const abs = Math.abs(value.minor);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}
