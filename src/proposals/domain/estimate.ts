// Estimate lines: an item, hours or a quantity, a rate, and the total they
// make (roadmap v0.4). Quantities are kept as hundredths, money as cents, so
// nothing is ever a floating-point amount.
import { money, parseAmount, type Money } from "../../shared/domain/money.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const LINE_KINDS = ["hours", "quantity"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export type EstimateLine = {
  readonly item: string;
  readonly kind: LineKind;
  /** Hours or units, in hundredths: 150 is 1.5. */
  readonly quantity: number;
  /** Per hour or per unit. */
  readonly rate: Money;
  readonly total: Money;
};

/** One row of the estimate form, as typed. */
export type LineInput = { readonly item: string; readonly kind: string; readonly quantity: string; readonly rate: string };

export type LineError = "line-item-missing" | "line-item-too-long" | "line-kind-invalid" | "line-quantity-invalid" | "line-rate-invalid" | "too-many-lines";

export const MAX_LINES = 40;

const blank = (row: LineInput): boolean => row.item.trim() === "" && row.quantity.trim() === "" && row.rate.trim() === "";

/** "1.5" → 150. Up to 99,999.99, never negative. */
export function parseQuantity(text: string): Result<number, "line-quantity-invalid"> {
  const cleaned = text.trim();
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(cleaned)) return err("line-quantity-invalid");
  const [whole = "0", part = ""] = cleaned.split(".");
  return ok(Number(whole) * 100 + Number(part.padEnd(2, "0")));
}

/** 150 → "1.5", 200 → "2". */
export function formatQuantity(hundredths: number): string {
  const text = (hundredths / 100).toFixed(2);
  return text.replace(/\.?0+$/, "");
}

export function lineTotal(quantity: number, rate: Money): Money {
  return { minor: Math.round((quantity * rate.minor) / 100), currency: rate.currency };
}

/** Reads the form's rows. A row left entirely empty is skipped. */
export function parseLines(rows: readonly LineInput[]): Result<EstimateLine[], LineError> {
  const lines: EstimateLine[] = [];
  for (const row of rows) {
    if (blank(row)) continue;
    const item = row.item.trim();
    if (item === "") return err("line-item-missing");
    if (item.length > 200) return err("line-item-too-long");
    if (!(LINE_KINDS as readonly string[]).includes(row.kind)) return err("line-kind-invalid");
    const quantity = parseQuantity(row.quantity.trim() === "" ? "1" : row.quantity);
    if (!quantity.ok) return quantity;
    const rate = parseAmount(row.rate.trim() === "" ? "0" : row.rate, "USD");
    if (!rate.ok) return err("line-rate-invalid");
    const total = lineTotal(quantity.value, rate.value);
    if (!money(total.minor, total.currency).ok) return err("line-rate-invalid");
    lines.push({ item, kind: row.kind as LineKind, quantity: quantity.value, rate: rate.value, total });
  }
  return lines.length > MAX_LINES ? err("too-many-lines") : ok(lines);
}

export type EstimateSummary = {
  readonly total: Money;
  /** Every hours line added up, in minutes. */
  readonly minutes: number;
};

export function summarize(lines: readonly EstimateLine[]): EstimateSummary {
  return {
    total: { minor: lines.reduce((sum, line) => sum + line.total.minor, 0), currency: "USD" },
    minutes: lines.filter((line) => line.kind === "hours").reduce((sum, line) => sum + Math.round((line.quantity * 60) / 100), 0),
  };
}

/** A deposit is one third of a fixed quote (docs/workflow.md, B4), rounded up to the cent. Null when there is none. */
export function depositFor(pricing: string, total: Money): Money | null {
  return pricing === "fixed" && total.minor > 0 ? { minor: Math.ceil(total.minor / 3), currency: total.currency } : null;
}
