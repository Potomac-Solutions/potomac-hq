// "How did we do?" (2026-11-26).
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type FeedbackError = "invalid-score" | "note-too-long";

/** At or under this, someone calls the client. */
export const LOW_SCORE = 3;

export function readFeedback(input: { readonly score: string; readonly note?: string | null }): Result<{ score: number; note: string }, FeedbackError> {
  const score = Number(input.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) return err("invalid-score");
  const note = (input.note ?? "").trim();
  if (note.length > 1000) return err("note-too-long");
  return ok({ score, note });
}

export const SCORE_WORDS: Readonly<Record<number, string>> = { 1: "Poor", 2: "Not great", 3: "Okay", 4: "Good", 5: "Great" };
