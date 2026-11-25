// The Claude models HQ knows the prices of, and what a call cost (decision
// 0012, Phase 0). Prices are kept in millionths of a dollar per million
// tokens, so every sum stays a whole number.
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type ModelPrice = {
  /** Millionths of a dollar per million input tokens. */
  readonly input: number;
  /** Millionths of a dollar per million output tokens. */
  readonly output: number;
  /** A dearer rate for prompts longer than `above` input tokens, as Haiku 5.5 has. */
  readonly long?: { readonly above: number; readonly input: number; readonly output: number };
};

export type KnownModel = { readonly id: string; readonly label: string; readonly price: ModelPrice };

/**
 * Anthropic's list prices, October 2026 (platform.claude.com pricing). Haiku
 * 5.5 is the cheapest and the default; it charges five times as much for a
 * prompt over 100,000 tokens, which HQ's prompts never come near.
 */
export const KNOWN_MODELS: readonly KnownModel[] = [
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5: fastest and cheapest", price: { input: 100_000, output: 500_000, long: { above: 100_000, input: 500_000, output: 2_500_000 } } },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5: better writing, 20 times the price", price: { input: 2_000_000, output: 10_000_000 } },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5: very capable, 40 times the price", price: { input: 4_000_000, output: 20_000_000 } },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2: the most capable, 80 times the price", price: { input: 8_000_000, output: 40_000_000 } },
];

export const DEFAULT_MODEL = "claude-haiku-5-5";

/**
 * The dearest model anyone may pick when they ask (Mikey, 2026-11-25). Opus
 * 5.5 to start, the site builder's own default, so nothing it did changes.
 */
export const DEFAULT_CEILING = "claude-opus-5-5";

export const knownModel = (id: string): KnownModel | null => KNOWN_MODELS.find((one) => one.id === id) ?? null;

/** What a call cost, in millionths of a dollar, rounded up. */
export function costOf(price: ModelPrice, inputCount: number, outputCount: number): number {
  const rate = price.long && inputCount > price.long.above ? price.long : price;
  return Math.ceil((inputCount * rate.input + outputCount * rate.output) / 1_000_000);
}

/** Millionths of a dollar as people read them: "$0.0042", "$1.37". */
export function dollarsText(micros: number): string {
  if (micros > 0 && micros < 10_000) return `$0.${String(Math.max(1, Math.round(micros / 100))).padStart(4, "0").replace(/0+$/, "")}`;
  const cents = Math.round(micros / 10_000);
  return `$${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}

/** A model id as the API takes it: lower case letters, digits, dots and dashes. */
export function readModelId(text: string): Result<string, "model-invalid"> {
  const id = text.trim();
  return /^[a-z0-9][a-z0-9.-]{2,79}$/.test(id) ? ok(id) : err("model-invalid");
}

/** "$2.50" per million tokens, typed, into millionths of a dollar. Up to $1,000. */
export function readPrice(text: string): Result<number, "price-invalid"> {
  const cleaned = text.trim().replace(/^\$/, "");
  if (!/^\d{1,4}(\.\d{1,6})?$/.test(cleaned)) return err("price-invalid");
  const [whole = "0", part = ""] = cleaned.split(".");
  const micros = Number(whole) * 1_000_000 + Number(part.padEnd(6, "0"));
  return micros <= 1_000_000_000 ? ok(micros) : err("price-invalid");
}
