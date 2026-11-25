// What Claude costs, and the hard stop (decision 0010, section 4). Money
// here is in micro-dollars (a millionth of a dollar), whole numbers, so a
// month of small requests adds up exactly. A price per million tokens is
// then simply micro-dollars per token.

export type ModelPrice = {
  readonly id: string;
  readonly label: string;
  /** Dollars per million input tokens. */
  readonly input: number;
  /** Dollars per million output tokens. */
  readonly output: number;
  /** A higher price for a prompt over `above` input tokens, where the model has one. */
  readonly long?: { readonly above: number; readonly input: number; readonly output: number };
};

/** Base prices as of 2026-11-25 (platform.claude.com, About Claude: Pricing). A model not here can't be chosen. */
export const MODELS: readonly ModelPrice[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", input: 4, output: 20 },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", input: 2, output: 10 },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", input: 0.1, output: 0.5, long: { above: 100_000, input: 0.5, output: 2.5 } },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2", input: 8, output: 40 },
];

export const DEFAULT_MODEL = "claude-opus-5-5";
/** The cap a new install starts with: $10 a month (confirmed by Mikey, 2026-11-25). */
export const DEFAULT_CAP_CENTS = 1_000;
export const MAX_CAP_CENTS = 100_000;
/** The most output one request may produce. Its cost is reserved before it is sent. */
export const MAX_OUTPUT_TOKENS = 32_000;

export const modelById = (id: string): ModelPrice | null => MODELS.find((one) => one.id === id) ?? null;

/** What a request costs, rounded up to a whole micro-dollar. */
export function costMicros(model: ModelPrice, usage: { readonly input: number; readonly output: number }): number {
  const rate = model.long && usage.input > model.long.above ? model.long : model;
  return Math.ceil(usage.input * rate.input + usage.output * rate.output);
}

/**
 * An overestimate of the input tokens in a text, before it is sent. A token
 * is about four characters of English and three of code; counting one per
 * two characters stays above both, so the reservation is never too small.
 */
export const estimateInputTokens = (chars: number): number => Math.ceil(chars / 2) + 500;

/** The most a request can cost: its estimated input and every output token it may use. */
export const worstCaseMicros = (model: ModelPrice, promptChars: number): number => costMicros(model, { input: estimateInputTokens(promptChars), output: MAX_OUTPUT_TOKENS });

export const centsToMicros = (cents: number): number => cents * 10_000;

/** Whether a request fits under the cap with this month's spending. Equal to the cap still fits. */
export const fitsUnderCap = (spentMicros: number, reserveMicros: number, capCents: number): boolean => spentMicros + reserveMicros <= centsToMicros(capCents);

/** "$1.23", or "$0.004" for less than a cent, so a cheap request doesn't read as free. */
export function dollars(micros: number): string {
  if (micros > 0 && micros < 10_000) return `$${(micros / 1_000_000).toFixed(3)}`;
  return `$${(Math.round(micros / 10_000) / 100).toFixed(2)}`;
}

export type CapError = "cap-invalid";

/** A cap typed in dollars, like "10" or "12.50", in cents. */
export function parseCap(text: string): { ok: true; value: number } | { ok: false; error: CapError } {
  const trimmed = text.trim().replace(/^\$/, "");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(trimmed)) return { ok: false, error: "cap-invalid" };
  const cents = Math.round(Number(trimmed) * 100);
  return cents >= 100 && cents <= MAX_CAP_CENTS ? { ok: true, value: cents } : { ok: false, error: "cap-invalid" };
}
