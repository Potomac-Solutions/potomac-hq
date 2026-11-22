// A proposal: what Potomac offers to do for an opportunity, and for how much
// (roadmap v0.4). It is edited as a draft, sent as a numbered version that
// can never change, and then accepted or declined.
import { calendarDate, optionalText, requiredText } from "../../shared/domain/fields.ts";
import type { Id } from "../../shared/domain/id.ts";
import type { Money } from "../../shared/domain/money.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";
import { parseLines, summarize, type EstimateLine, type LineError, type LineInput } from "./estimate.ts";

export const PROPOSAL_STATUSES = ["draft", "sent", "revised", "accepted", "declined"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** The same five shapes an opportunity is priced in (docs/data-model.md). */
export const PRICINGS = ["free", "hourly", "fixed", "monthly", "yearly"] as const;
export type Pricing = (typeof PRICINGS)[number];

export type ProposalContent = {
  readonly title: string;
  readonly pricing: Pricing;
  readonly scope: string;
  readonly assumptions: string;
  readonly exclusions: string;
  readonly deliverables: string;
  readonly lines: readonly EstimateLine[];
};

export type Proposal = ProposalContent & {
  readonly id: Id;
  readonly opportunityId: Id;
  readonly status: ProposalStatus;
  /** The number of the last version sent. 0 before the first. */
  readonly currentVersion: number;
  /** Whether the client can see sent versions in the portal (v0.6). */
  readonly sharedWithClient: boolean;
  readonly createdBy: Id;
};

/** What was sent. Never edited afterwards. */
export type ProposalVersion = ProposalContent & {
  readonly proposalId: Id;
  readonly number: number;
  readonly total: Money;
  readonly minutes: number;
  readonly sentBy: Id;
  readonly sentAt: string;
};

export const DECISION_METHODS = ["in-person", "phone", "email", "signed-paper", "portal"] as const;
export type DecisionMethod = (typeof DECISION_METHODS)[number];

/** Who accepted or declined, when, how, and which version. */
export type Decision = {
  readonly proposalId: Id;
  readonly version: number;
  readonly decision: "accepted" | "declined";
  readonly byName: string;
  /** YYYY-MM-DD. */
  readonly on: string;
  readonly method: DecisionMethod;
  readonly note: string | null;
  readonly recordedBy: Id | null;
  readonly recordedAt: string;
};

export type ProposalInput = {
  readonly title: string;
  readonly pricing: string;
  readonly scope?: string | null;
  readonly assumptions?: string | null;
  readonly exclusions?: string | null;
  readonly deliverables?: string | null;
  readonly lines: readonly LineInput[];
};

export type ContentError = "title-missing" | "title-too-long" | "invalid-pricing" | "section-too-long" | LineError;

const isPricing = (value: string): value is Pricing => (PRICINGS as readonly string[]).includes(value);
export const isOpenProposal = (proposal: Proposal): boolean => proposal.status !== "accepted" && proposal.status !== "declined";

function content(input: ProposalInput): Result<ProposalContent, ContentError> {
  const title = requiredText(input.title, 200);
  if (!title.ok) return err(title.error === "missing" ? "title-missing" : "title-too-long");
  if (!isPricing(input.pricing)) return err("invalid-pricing");
  const sections: string[] = [];
  for (const section of [input.scope, input.assumptions, input.exclusions, input.deliverables]) {
    const text = optionalText(section, 8000);
    if (!text.ok) return err("section-too-long");
    sections.push(text.value ?? "");
  }
  const lines = parseLines(input.lines);
  if (!lines.ok) return lines;
  const [scope = "", assumptions = "", exclusions = "", deliverables = ""] = sections;
  return ok({ title: title.value, pricing: input.pricing, scope, assumptions, exclusions, deliverables, lines: lines.value });
}

/** A new draft, usually filled from a template. */
export function newProposal(ids: { readonly id: Id; readonly opportunityId: Id; readonly createdBy: Id }, input: ProposalInput): Result<Proposal, ContentError> {
  const checked = content(input);
  if (!checked.ok) return checked;
  return ok({ ...ids, ...checked.value, status: "draft", currentVersion: 0, sharedWithClient: false });
}

/** Saves the working copy. Editing a proposal that was sent makes it `revised`: the sent version itself is untouched. */
export function editProposal(proposal: Proposal, input: ProposalInput): Result<Proposal, ContentError | "closed"> {
  if (!isOpenProposal(proposal)) return err("closed");
  const checked = content(input);
  if (!checked.ok) return checked;
  return ok({ ...proposal, ...checked.value, status: proposal.status === "sent" ? "revised" : proposal.status });
}

export type SendError = "closed" | "already-sent" | "no-lines" | "total-required" | "free-must-be-zero";

/** Sends the working copy as the next version. */
export function sendProposal(proposal: Proposal, by: Id, at: string): Result<{ proposal: Proposal; version: ProposalVersion }, SendError> {
  if (!isOpenProposal(proposal)) return err("closed");
  if (proposal.status === "sent") return err("already-sent");
  if (proposal.lines.length === 0) return err("no-lines");
  const { total, minutes } = summarize(proposal.lines);
  if (proposal.pricing === "free" && total.minor !== 0) return err("free-must-be-zero");
  if (proposal.pricing !== "free" && total.minor <= 0) return err("total-required");
  const number = proposal.currentVersion + 1;
  const { title, pricing, scope, assumptions, exclusions, deliverables, lines } = proposal;
  return ok({
    proposal: { ...proposal, status: "sent", currentVersion: number },
    version: { proposalId: proposal.id, number, title, pricing, scope, assumptions, exclusions, deliverables, lines, total, minutes, sentBy: by, sentAt: at },
  });
}

export type DecisionInput = { readonly decision: string; readonly byName: string; readonly on: string; readonly method: string; readonly note?: string | null };
export type DecisionError = "closed" | "not-sent" | "revised-not-sent" | "invalid-decision" | "decided-by-missing" | "decided-by-too-long" | "invalid-date" | "invalid-method" | "note-too-long";

/** Records the client's answer to the version they were sent. */
export function decideProposal(proposal: Proposal, input: DecisionInput, recordedBy: Id | null, at: string): Result<{ proposal: Proposal; decision: Decision }, DecisionError> {
  if (!isOpenProposal(proposal)) return err("closed");
  if (proposal.status === "draft") return err("not-sent");
  if (proposal.status === "revised") return err("revised-not-sent");
  if (input.decision !== "accepted" && input.decision !== "declined") return err("invalid-decision");
  const byName = requiredText(input.byName, 200);
  if (!byName.ok) return err(byName.error === "missing" ? "decided-by-missing" : "decided-by-too-long");
  const on = calendarDate(input.on.trim());
  if (!on.ok) return on;
  if (!(DECISION_METHODS as readonly string[]).includes(input.method)) return err("invalid-method");
  const note = optionalText(input.note, 2000);
  if (!note.ok) return err("note-too-long");
  return ok({
    proposal: { ...proposal, status: input.decision },
    decision: { proposalId: proposal.id, version: proposal.currentVersion, decision: input.decision, byName: byName.value, on: on.value, method: input.method as DecisionMethod, note: note.value, recordedBy, recordedAt: at },
  });
}

/**
 * The price an opportunity carries for a sent version: the total for fixed
 * and recurring work, the hourly rate for hourly work (the highest, if lines
 * differ), and zero when free.
 */
export function opportunityValue(version: Pick<ProposalVersion, "pricing" | "lines" | "total">): Money {
  if (version.pricing !== "hourly") return version.total;
  const rates = version.lines.filter((line) => line.kind === "hours").map((line) => line.rate.minor);
  return { minor: rates.length > 0 ? Math.max(...rates) : version.total.minor, currency: version.total.currency };
}

/** A section's text as paragraphs and bullets. A line starting "- " is a bullet. */
export function sectionBlocks(text: string): { readonly bullet: boolean; readonly text: string }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => (/^[-*•]\s+/.test(line) ? { bullet: true, text: line.replace(/^[-*•]\s+/, "") } : { bullet: false, text: line }));
}
