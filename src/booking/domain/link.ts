// A booking link: Potomac gives it to someone so they can book a call
// without a portal account.
import { err, ok, type Result } from "../../shared/domain/result.ts";
import type { Id } from "../../shared/domain/id.ts";

export type BookingLink = {
  readonly id: Id;
  readonly token: string;
  /** Who it was made for. */
  readonly label: string;
  readonly oneTime: boolean;
  /** The last day it works; null for no end. */
  readonly lastDay: string | null;
  readonly uses: number;
  readonly withdrawnAt: string | null;
  readonly createdBy: Id;
  readonly createdAt: string;
};

/** How long a new link can last, in days. "" is no end. */
export const LINK_LASTS = ["7", "30", "90", ""] as const;
export type LinkInput = { readonly label: string; readonly lasts: string; readonly oneTime: boolean };
export type LinkError = "label-missing" | "label-too-long" | "lasts-invalid";

export function newLink(ids: { readonly id: Id; readonly token: string; readonly createdBy: Id }, input: LinkInput, today: string, now: string): Result<BookingLink, LinkError> {
  const label = input.label.trim().replace(/\s+/g, " ");
  if (!label) return err("label-missing");
  if (label.length > 80) return err("label-too-long");
  if (!(LINK_LASTS as readonly string[]).includes(input.lasts)) return err("lasts-invalid");
  const lastDay = input.lasts === "" ? null : Temporal.PlainDate.from(today).add({ days: Number(input.lasts) }).toString();
  return ok({ id: ids.id, token: ids.token, label, oneTime: input.oneTime, lastDay, uses: 0, withdrawnAt: null, createdBy: ids.createdBy, createdAt: now });
}

export type LinkState = "open" | "used" | "ended" | "withdrawn";
export const LINK_STATE_LABELS: Readonly<Record<LinkState, string>> = { open: "Open", used: "Used", ended: "Ended", withdrawn: "Withdrawn" };

/** Whether a link still books calls today, and if not, why. */
export function linkState(link: Pick<BookingLink, "oneTime" | "lastDay" | "uses" | "withdrawnAt">, today: string): LinkState {
  if (link.withdrawnAt !== null) return "withdrawn";
  if (link.oneTime && link.uses > 0) return "used";
  if (link.lastDay !== null && link.lastDay < today) return "ended";
  return "open";
}

export type LinkBooker = { readonly name: string; readonly email: string; readonly phone: string; readonly business: string; readonly topic: string };
export type LinkBookerError = "topic-missing" | "business-too-long" | "phone-missing";

/**
 * What a link asks beyond a name and an email: what the call is about, in
 * a sentence at least, and a phone number to call. The business is optional.
 */
export function checkLinkBooker(input: { readonly phone?: string | null; readonly business?: string | null; readonly topic?: string | null }): Result<{ readonly business: string }, LinkBookerError> {
  if ((input.topic ?? "").trim().length < 3) return err("topic-missing");
  if (!(input.phone ?? "").trim()) return err("phone-missing");
  const business = (input.business ?? "").trim().replace(/\s+/g, " ");
  if (business.length > 120) return err("business-too-long");
  return ok({ business });
}
