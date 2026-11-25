// A touch: a call, email, text or meeting with someone at a client, and for a
// call, how it went. Touches are the timeline of a relationship.
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const TOUCH_KINDS = ["call", "email", "text", "meeting"] as const;
export type TouchKind = (typeof TOUCH_KINDS)[number];
export const TOUCH_KIND_LABELS: Readonly<Record<TouchKind, string>> = { call: "Call", email: "Email", text: "Text", meeting: "Meeting" };
export const OUTCOMES = ["reached", "voicemail", "no-answer"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = { reached: "Talked", voicemail: "Left a voicemail", "no-answer": "No answer" };

export type Touch = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly opportunityId: Id | null;
  readonly contactId: Id | null;
  readonly kind: TouchKind;
  /** Only for a call. */
  readonly outcome: Outcome | null;
  readonly note: string;
  readonly happenedAt: string;
  readonly userId: Id;
  /** How long the call lasted, when it came from the call screen (decision 0009). */
  readonly minutes: number | null;
  readonly callId: Id | null;
};

export type TouchInput = { readonly kind: string; readonly outcome?: string | null; readonly note?: string | null };
export type TouchError = "invalid-kind" | "invalid-outcome" | "note-too-long" | "note-missing";

export function newTouch(ids: { readonly id: Id; readonly organizationId: Id; readonly opportunityId: Id | null; readonly contactId: Id | null; readonly userId: Id; readonly happenedAt: string }, input: TouchInput): Result<Touch, TouchError> {
  if (!(TOUCH_KINDS as readonly string[]).includes(input.kind)) return err("invalid-kind");
  const kind = input.kind as TouchKind;
  const outcomeText = (input.outcome ?? "").trim();
  if (outcomeText && !(OUTCOMES as readonly string[]).includes(outcomeText)) return err("invalid-outcome");
  // An outcome only means something for a call; a call without one was a conversation.
  const outcome: Outcome | null = kind === "call" ? ((outcomeText || "reached") as Outcome) : null;
  const note = (input.note ?? "").trim();
  if (note.length > 2000) return err("note-too-long");
  // A talk, an email, a text or a meeting needs a word about it; a voicemail or no answer speaks for itself.
  if (!note && (outcome === null || outcome === "reached")) return err("note-missing");
  return ok({ ...ids, kind, outcome, note, minutes: null, callId: null });
}

/** "Call, left a voicemail" or "Meeting". */
export function touchLabel(touch: Pick<Touch, "kind" | "outcome">): string {
  const kind = TOUCH_KIND_LABELS[touch.kind];
  if (touch.kind !== "call" || touch.outcome === null) return kind;
  return touch.outcome === "reached" ? "Call, talked" : touch.outcome === "voicemail" ? "Call, left a voicemail" : "Call, no answer";
}
