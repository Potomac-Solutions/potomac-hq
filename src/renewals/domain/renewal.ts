// Renewals: what a client's web presence depends on that runs out on a date,
// such as a domain, hosting, an SSL certificate, email or a software license.
// What it costs Potomac, what Potomac bills, and when it renews.
import { calendarDate, optionalText, requiredText } from "../../shared/domain/fields.ts";
import type { Id } from "../../shared/domain/id.ts";
import { parseAmount, type Money } from "../../shared/domain/money.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const RENEWAL_KINDS = ["domain", "hosting", "ssl", "email", "software", "other"] as const;
export type RenewalKind = (typeof RENEWAL_KINDS)[number];
export const RENEWAL_KIND_LABELS: Readonly<Record<RenewalKind, string>> = { domain: "Domain", hosting: "Hosting", ssl: "SSL certificate", email: "Email", software: "Software license", other: "Other" };
export const TERMS = [1, 3, 6, 12, 24, 36, 60, 120] as const;
export const TERM_LABELS: Readonly<Record<number, string>> = { 1: "Every month", 3: "Every 3 months", 6: "Every 6 months", 12: "Every year", 24: "Every 2 years", 36: "Every 3 years", 60: "Every 5 years", 120: "Every 10 years" };
/** How far ahead a renewal counts as coming up. */
export const SOON_DAYS = 30;

export type Renewal = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly kind: RenewalKind;
  /** "feedstore.com", "Shared hosting", "Google Workspace, 3 seats". */
  readonly name: string;
  /** Who it is bought from: "Cloudflare", "Namecheap". */
  readonly provider: string;
  readonly renewsOn: string;
  readonly termMonths: number;
  /** What it costs Potomac each term. Null if not known. */
  readonly cost: Money | null;
  /** What Potomac bills the client each term. Null if not billed. */
  readonly price: Money | null;
  /** The provider renews it by itself: a reminder, not a task. */
  readonly autoRenews: boolean;
  readonly note: string;
  readonly active: boolean;
};

export type RenewalInput = { readonly kind: string; readonly name: string; readonly provider?: string | null; readonly renewsOn: string; readonly termMonths: string; readonly cost?: string | null; readonly price?: string | null; readonly autoRenews?: boolean; readonly note?: string | null };
export type RenewalError = "invalid-kind" | "name-missing" | "name-too-long" | "provider-too-long" | "invalid-date" | "invalid-term" | "not-an-amount" | "note-too-long";

function optionalMoney(text: string | null | undefined): Result<Money | null, "not-an-amount"> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return ok(null);
  const parsed = parseAmount(trimmed, "USD");
  return parsed.ok && parsed.value.minor >= 0 ? ok(parsed.value) : err("not-an-amount");
}

export function newRenewal(ids: { readonly id: Id; readonly organizationId: Id }, input: RenewalInput): Result<Renewal, RenewalError> {
  if (!(RENEWAL_KINDS as readonly string[]).includes(input.kind)) return err("invalid-kind");
  const name = requiredText(input.name, 120);
  if (!name.ok) return err(name.error === "missing" ? "name-missing" : "name-too-long");
  const provider = optionalText(input.provider, 80);
  if (!provider.ok) return err("provider-too-long");
  const renewsOn = calendarDate(input.renewsOn.trim());
  if (!renewsOn.ok) return renewsOn;
  const term = Number(input.termMonths);
  if (!(TERMS as readonly number[]).includes(term)) return err("invalid-term");
  const cost = optionalMoney(input.cost);
  if (!cost.ok) return cost;
  const price = optionalMoney(input.price);
  if (!price.ok) return price;
  const note = optionalText(input.note, 500);
  if (!note.ok) return err("note-too-long");
  return ok({ ...ids, kind: input.kind as RenewalKind, name: name.value, provider: provider.value ?? "", renewsOn: renewsOn.value, termMonths: term, cost: cost.value, price: price.value, autoRenews: input.autoRenews === true, note: note.value ?? "", active: true });
}

/** Renewed: its date moves on one term, from the date it was due, not from today. */
export function renewed(renewal: Renewal): Renewal {
  return { ...renewal, renewsOn: Temporal.PlainDate.from(renewal.renewsOn).add({ months: renewal.termMonths }).toString() };
}

export type RenewalState = "overdue" | "soon" | "later";

export function stateOf(renewal: Renewal, today: string): RenewalState {
  const days = Temporal.PlainDate.from(today).until(renewal.renewsOn).days;
  return days < 0 ? "overdue" : days <= SOON_DAYS ? "soon" : "later";
}

/** Its cost and price spread over a year, in cents. */
export function yearly(renewal: Renewal): { readonly cost: number; readonly price: number } {
  const times = 12 / renewal.termMonths;
  return { cost: Math.round((renewal.cost?.minor ?? 0) * times), price: Math.round((renewal.price?.minor ?? 0) * times) };
}
