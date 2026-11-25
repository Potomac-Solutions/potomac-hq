// Call guides (decision 0009, section 2): which guide a call starts with,
// the questions as someone edits them, and the summary a call's answers make
// for the call log. Pure rules, tested with nothing installed.
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const SITUATIONS = ["first-call", "proposal-follow-up", "project-check-in", "renewal", "any"] as const;
export type Situation = (typeof SITUATIONS)[number];
export const isSituation = (value: string): value is Situation => (SITUATIONS as readonly string[]).includes(value);

/** When each guide is the one HQ picks. */
export const SITUATION_HINTS: Readonly<Record<Situation, string>> = {
  "first-call": "A prospect with no proposal yet",
  "proposal-follow-up": "A proposal sent and not answered",
  "project-check-in": "An active project",
  renewal: "A renewal in the next 30 days",
  any: "Anything else",
};

export const MAX_QUESTIONS = 20;
export const MAX_QUESTION_LENGTH = 200;
export const MAX_ANSWER_LENGTH = 1000;

/** What HQ knows about a client that decides the guide. */
export type GuideFacts = {
  readonly hasProposalOrProject: boolean;
  readonly proposalWaiting: boolean;
  readonly activeProject: boolean;
  readonly renewalSoon: boolean;
};

/**
 * The guide a call starts with: a first call for someone with nothing yet,
 * then a waiting proposal, an active project and a renewal, in that order;
 * otherwise "any call".
 */
export function pickSituation(facts: GuideFacts): Situation {
  if (!facts.hasProposalOrProject) return "first-call";
  if (facts.proposalWaiting) return "proposal-follow-up";
  if (facts.activeProject) return "project-check-in";
  if (facts.renewalSoon) return "renewal";
  return "any";
}

export type GuideError = "guide-title-missing" | "guide-title-too-long" | "questions-missing" | "too-many-questions" | "question-too-long";

/** A guide as someone typed it: a title, and one question a line. Blank lines are dropped. */
export function readGuide(input: { readonly title: string; readonly questions: string }): Result<{ readonly title: string; readonly questions: readonly string[] }, GuideError> {
  const title = input.title.trim();
  if (!title) return err("guide-title-missing");
  if (title.length > 80) return err("guide-title-too-long");
  const questions = input.questions.split(/\r?\n/).map((line) => line.trim().replace(/^[-*•]\s*|^\d+[.)]\s*/, "").trim()).filter(Boolean);
  if (questions.length === 0) return err("questions-missing");
  if (questions.length > MAX_QUESTIONS) return err("too-many-questions");
  if (questions.some((one) => one.length > MAX_QUESTION_LENGTH)) return err("question-too-long");
  return ok({ title, questions });
}

export type Answer = { readonly question: string; readonly asked: boolean; readonly answer: string };

/**
 * What the call log keeps from the guide: each question asked or answered,
 * with its answer, after the notes. Fits the log's 2,000 characters, the
 * notes first.
 */
export function callSummary(note: string, answers: readonly Answer[]): string {
  const lines = answers.filter((one) => one.asked || one.answer.trim()).map((one) => (one.answer.trim() ? `${one.question} ${one.answer.trim()}` : `${one.question} (asked)`));
  const text = [note.trim(), lines.map((line) => `- ${line}`).join("\n")].filter(Boolean).join("\n\n");
  return text.length <= 2000 ? text : `${text.slice(0, 1999)}…`;
}
