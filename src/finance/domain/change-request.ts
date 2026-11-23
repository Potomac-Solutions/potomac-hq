// A change request: work beyond what was agreed, with what it adds to the
// price and the hours. Potomac drafts it and sends it; the client approves or
// declines it, or Potomac records the client's answer given another way. An
// approved change raises the budget and is invoiced.
import type { Id } from "../../shared/domain/id.ts";
import { parseAmount, type Money } from "../../shared/domain/money.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";
import { parseHours } from "../../shared/domain/hours.ts";

export const CHANGE_STATUSES = ["draft", "sent", "approved", "declined", "withdrawn"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];
export const CHANGE_STATUS_LABELS: Readonly<Record<ChangeStatus, string>> = {
  draft: "Draft",
  sent: "Waiting for the client",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export type ChangeRequest = {
  readonly id: Id;
  readonly projectId: Id;
  /** Counted per project: Change 1, Change 2. */
  readonly number: number;
  readonly title: string;
  readonly description: string;
  /** What it adds to the price. Zero for a change at no charge. */
  readonly amount: Money;
  /** What it adds to the hours, or null when it adds none. */
  readonly minutes: number | null;
  readonly status: ChangeStatus;
  readonly sentAt: string | null;
  readonly decidedAt: string | null;
  /** Who answered: the client in the portal, or someone at Potomac recording it. */
  readonly decidedBy: { readonly clientUserId: Id } | { readonly userId: Id } | null;
  readonly decisionNote: string;
  readonly invoiceId: Id | null;
  readonly createdBy: Id;
};

export type ChangeInput = { readonly title: string; readonly description?: string | null; readonly amount: string; readonly hours?: string | null };
export type ChangeError = "title-missing" | "title-too-long" | "description-too-long" | "not-an-amount" | "invalid-hours";

export function newChangeRequest(ids: { readonly id: Id; readonly projectId: Id; readonly number: number; readonly createdBy: Id }, input: ChangeInput): Result<ChangeRequest, ChangeError> {
  const title = input.title.trim();
  if (!title) return err("title-missing");
  if (title.length > 120) return err("title-too-long");
  const description = (input.description ?? "").trim();
  if (description.length > 2000) return err("description-too-long");
  const amountText = input.amount.trim() || "0";
  const amount = parseAmount(amountText, "USD");
  if (!amount.ok || amount.value.minor < 0) return err("not-an-amount");
  const hoursText = (input.hours ?? "").trim();
  let minutes: number | null = null;
  if (hoursText) {
    const parsed = parseHours(hoursText);
    if (!parsed.ok || parsed.value === null || parsed.value <= 0) return err("invalid-hours");
    minutes = parsed.value;
  }
  return ok({ ...ids, title, description, amount: amount.value, minutes, status: "draft", sentAt: null, decidedAt: null, decidedBy: null, decisionNote: "", invoiceId: null });
}

/** Sends a draft to the client. */
export function sendChange(change: ChangeRequest, at: string): Result<ChangeRequest, "already-sent"> {
  return change.status === "draft" ? ok({ ...change, status: "sent", sentAt: at }) : err("already-sent");
}

/** Takes it back before the client has answered. */
export function withdrawChange(change: ChangeRequest): Result<ChangeRequest, "already-answered"> {
  return change.status === "draft" || change.status === "sent" ? ok({ ...change, status: "withdrawn" }) : err("already-answered");
}

/** The client's answer. A decline may say why; an approval may add a word. */
export function decideChange(change: ChangeRequest, decision: string, note: string | null | undefined, by: NonNullable<ChangeRequest["decidedBy"]>, at: string): Result<ChangeRequest, "not-waiting" | "invalid-decision" | "note-too-long"> {
  if (change.status !== "sent") return err("not-waiting");
  if (decision !== "approve" && decision !== "decline") return err("invalid-decision");
  const text = (note ?? "").trim();
  if (text.length > 1000) return err("note-too-long");
  return ok({ ...change, status: decision === "approve" ? "approved" : "declined", decidedAt: at, decidedBy: by, decisionNote: text });
}
