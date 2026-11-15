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
