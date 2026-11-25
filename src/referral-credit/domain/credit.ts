// Thanking the person who sent them (decision 0010, section 7). Who referred
// a lead (a client, or a person typed in), and the credit a client earns
// when someone they referred pays their first invoice.
import { optionalText } from "../../shared/domain/fields.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

/** What a referral is worth until it's set: $25. */
export const DEFAULT_CREDIT_MINOR = 2500;
/** A credit never takes an invoice below this: it can cover all but the last dollar. */
export const LEAST_LEFT_MINOR = 100;

/** How much credit to take off an invoice: what's available, up to all but its last dollar. */
export function creditToApply(availableMinor: number, invoiceTotalMinor: number): number {
  return Math.max(0, Math.min(availableMinor, invoiceTotalMinor - LEAST_LEFT_MINOR));
}

/** A person who referred them, typed in: "Dale at the feed store". Empty for none. */
export function referrerName(typed: string): Result<string | null, "name-too-long"> {
  const name = optionalText(typed.replace(/\s+/g, " "), 100);
  return name.ok ? ok(name.value) : err("name-too-long");
}

/** A short code for a client's own link, from their name: "Moats Hardware" as "moats-hardware". */
export function codeFor(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : "client";
}
