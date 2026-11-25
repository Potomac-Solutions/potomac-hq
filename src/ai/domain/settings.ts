// What AI may do in HQ, and what it may spend (decision 0010). One row of
// settings: the model, its prices, the monthly budget, which features are on,
// and Potomac's price guide that lead triage reads. Every feature starts off.
import { err, ok, type Result } from "../../shared/domain/result.ts";
import { DEFAULT_MODEL, knownModel, readModelId, readPrice, type ModelPrice } from "./models.ts";

export const FEATURES = [
  "call-recap",
  "call-brief",
  "lead-triage",
  "check-in",
  "proposal-draft",
  "scope-check",
  "weekly-update",
  "ask",
  "receipt",
  "site-diagnosis",
  "case-study",
  "social-posts",
] as const;
export type Feature = (typeof FEATURES)[number];

export const isFeature = (value: string): value is Feature => (FEATURES as readonly string[]).includes(value);

/** Each feature's name and what it does, in the order of the roadmap's phases. */
export const FEATURE_TEXT: { readonly [K in Feature]: { readonly label: string; readonly what: string; readonly phase: string } } = {
  "call-recap": { label: "Call recap", what: "Drafts the recap email and next steps from a call's notes.", phase: "Calls" },
  "call-brief": { label: "Get ready brief", what: "A few lines on the client before a booked call.", phase: "Calls" },
  "lead-triage": { label: "Lead triage", what: "Reads each new inquiry and booking: likely service, price range, urgency, spam, and a reply.", phase: "Sales" },
  "check-in": { label: "Going-cold check-ins", what: "Drafts a short message to a deal that's gone quiet.", phase: "Sales" },
  "proposal-draft": { label: "Proposal first draft", what: "Drafts a proposal's scope and estimate lines, checked against similar jobs.", phase: "Sales" },
  "scope-check": { label: "Scope check", what: "Flags client messages that ask for more than was agreed, with a change request drafted.", phase: "Delivery" },
  "weekly-update": { label: "Weekly client update", what: "Drafts a plain update for each active project on Fridays.", phase: "Delivery" },
  ask: { label: "Ask HQ", what: "Answers questions from the knowledge base and decision log.", phase: "Delivery" },
  receipt: { label: "Receipt reading", what: "Reads a receipt's photo into an expense.", phase: "Money and admin" },
  "site-diagnosis": { label: "Site-down diagnosis", what: "Adds a likely cause and a first step to site alerts.", phase: "Money and admin" },
  "case-study": { label: "Case study drafts", what: "Drafts a case study for the Work page from a project's history.", phase: "Marketing" },
  "social-posts": { label: "Social post drafts", what: "Drafts Facebook, Instagram and LinkedIn posts from finished work.", phase: "Marketing" },
};

export type AiSettings = {
  readonly model: string;
  readonly price: ModelPrice;
  /** The most HQ may spend on AI in a calendar month, in cents. */
  readonly budgetMinor: number;
  readonly features: readonly Feature[];
  /** What Potomac charges, in its own words: lead triage reads it. */
  readonly priceGuide: string;
};

/** The starting point (decision 0010, confirmed by Mikey on Nov 25): Haiku 5.5, $20 a month, everything off. */
export const DEFAULT_SETTINGS: AiSettings = {
  model: DEFAULT_MODEL,
  price: { input: 100_000, output: 500_000, long: { above: 100_000, input: 500_000, output: 2_500_000 } },
  budgetMinor: 2000,
  features: [],
  priceGuide: "",
};

export const MAX_BUDGET_MINOR = 100_000;
export const MAX_PRICE_GUIDE = 4000;

export type SettingsInput = {
  /** A known model's id, or "other". */
  readonly model: string;
  /** With "other": the id, and its prices in dollars per million tokens. */
  readonly otherModel?: string;
  readonly otherInput?: string;
  readonly otherOutput?: string;
  /** Dollars a month, like "20" or "12.50". */
  readonly budget: string;
  readonly features: readonly string[];
  readonly priceGuide?: string;
};

export type SettingsError = "model-invalid" | "price-invalid" | "budget-invalid" | "price-guide-too-long";

export function readSettings(input: SettingsInput): Result<AiSettings, SettingsError> {
  let model: string;
  let price: ModelPrice;
  const known = knownModel(input.model.trim());
  if (known) {
    model = known.id;
    price = known.price;
  } else if (input.model.trim() === "other") {
    const id = readModelId(input.otherModel ?? "");
    if (!id.ok) return id;
    const inPrice = readPrice(input.otherInput ?? "");
    const outPrice = readPrice(input.otherOutput ?? "");
    if (!inPrice.ok) return inPrice;
    if (!outPrice.ok) return outPrice;
    model = id.value;
    price = knownModel(id.value)?.price ?? { input: inPrice.value, output: outPrice.value };
  } else return err("model-invalid");
  const budget = input.budget.trim().replace(/^\$/, "");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(budget)) return err("budget-invalid");
  const [whole = "0", part = ""] = budget.split(".");
  const budgetMinor = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  if (budgetMinor > MAX_BUDGET_MINOR) return err("budget-invalid");
  const priceGuide = (input.priceGuide ?? "").trim().replace(/\r\n/g, "\n");
  if (priceGuide.length > MAX_PRICE_GUIDE) return err("price-guide-too-long");
  const features = FEATURES.filter((one) => input.features.includes(one));
  return ok({ model, price, budgetMinor, features, priceGuide });
}

export type BudgetState = "ok" | "warning" | "reached";

/** Where this month stands: a warning from 80%, and stopped at the budget. */
export function budgetState(spentMicros: number, budgetMinor: number): BudgetState {
  const budgetMicros = budgetMinor * 10_000;
  if (spentMicros >= budgetMicros) return "reached";
  return spentMicros * 10 >= budgetMicros * 8 ? "warning" : "ok";
}

/**
 * Whether one more call may go: not once the month's budget is spent, and
 * not when the most it could cost would take the month past it.
 */
export function mayCall(spentMicros: number, budgetMinor: number, mostItCouldCost: number): boolean {
  return spentMicros + mostItCouldCost <= budgetMinor * 10_000;
}

/** The first instant of the month a day is in, as YYYY-MM-01. */
export const monthOf = (day: string): string => `${day.slice(0, 7)}-01`;
