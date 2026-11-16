// The proposals module's changes. Each one checks permission first, makes its
// change and writes its activity events in one transaction, and answers with
// a code.
import { summarize } from "../domain/estimate.ts";
import {
  decideProposal,
  editProposal,
  newProposal,
  opportunityValue,
  sendProposal,
  type ContentError,
  type Decision,
  type DecisionError,
  type DecisionInput,
  type Proposal,
  type ProposalInput,
  type ProposalVersion,
  type SendError,
} from "../domain/proposal.ts";
import { fromTemplate } from "../domain/templates.ts";
import { applyConversion, applyOpportunityValue, applyStageMove, type CrmDeps } from "../../crm/index.ts";
import { saveFile, type FilesDeps, type UploadError } from "../../files/index.ts";
import { authorize } from "../../identity/index.ts";
import { applyBaseline, type BaselineStore, type Project } from "../../projects/index.ts";
import { calendarDate, err, ok, optionalText, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { Agreement, ProposalStore } from "./ports.ts";

export type ProposalsDeps = CrmDeps &
  FilesDeps & {
    readonly proposals: ProposalStore;
    readonly baselines: BaselineStore;
    /** Today in the business time zone, YYYY-MM-DD. */
    readonly today: () => string;
    readonly formatWhen: (instant: string) => string;
  };

export type Refused = "forbidden" | "not-found";

function allowed(deps: ProposalsDeps, actorId: Id | null, action: string): actorId is Id {
  return actorId !== null && authorize(deps, actorId, action).ok;
}

/** Starts a draft for an open opportunity, filled from a service's template. */
export function startProposal(deps: ProposalsDeps, actorId: Id | null, opportunityId: Id, input: { readonly template?: string | null }): Result<Proposal, Refused | "opportunity-closed" | ContentError> {
  if (!allowed(deps, actorId, "proposal.edit")) return err("forbidden");
  return deps.transact(() => {
    const opportunity = deps.opportunities.get(opportunityId);
    if (!opportunity) return err("not-found");
    if (opportunity.stage === "won" || opportunity.stage === "lost") return err("opportunity-closed");
    const template = (input.template ?? "").trim() || opportunity.service;
    const proposal = newProposal({ id: deps.newId(), opportunityId, createdBy: actorId }, fromTemplate(template, opportunity.title));
    if (!proposal.ok) return proposal;
    deps.proposals.insert(proposal.value, deps.clock());
    recordActivity(deps, { actorId, action: "proposal.created", recordType: "proposal", recordId: proposal.value.id, context: { opportunityId, template: template ?? "blank" } });
    return ok(proposal.value);
  });
}

export function saveProposal(deps: ProposalsDeps, actorId: Id | null, proposalId: Id, input: ProposalInput): Result<Proposal, Refused | "closed" | ContentError> {
  if (!allowed(deps, actorId, "proposal.edit")) return err("forbidden");
  return deps.transact(() => {
    const proposal = deps.proposals.get(proposalId);
    if (!proposal) return err("not-found");
    const edited = editProposal(proposal, input);
    if (!edited.ok) return edited;
    deps.proposals.update(edited.value, deps.clock());
    recordActivity(deps, {
      actorId,
      action: "proposal.edited",
      recordType: "proposal",
      recordId: proposalId,
      context: { opportunityId: proposal.opportunityId, status: edited.value.status, lines: edited.value.lines.length, minor: summarize(edited.value.lines).total.minor },
    });
    return ok(edited.value);
  });
}

export type SendProposalError = Refused | SendError | "opportunity-closed" | "not-consulted-yet";

/**
 * Sends the working copy as the next version. The opportunity takes the
 * proposal's price, and moves from consulted to quoted: a sent proposal is
 * the quote (docs/workflow.md, B2).
 */
export function sendProposalVersion(deps: ProposalsDeps, actorId: Id | null, proposalId: Id): Result<ProposalVersion, SendProposalError> {
  if (!allowed(deps, actorId, "proposal.send")) return err("forbidden");
  return deps.transact(() => {
    const proposal = deps.proposals.get(proposalId);
    if (!proposal) return err("not-found");
    const opportunity = deps.opportunities.get(proposal.opportunityId);
    if (!opportunity) return err("not-found");
    if (opportunity.stage === "won" || opportunity.stage === "lost") return err("opportunity-closed");
    if (opportunity.stage !== "consulted" && opportunity.stage !== "quoted") return err("not-consulted-yet");
    const at = deps.clock();
    const sent = sendProposal(proposal, actorId, at);
    if (!sent.ok) return sent;
    deps.proposals.update(sent.value.proposal, at);
    deps.proposals.insertVersion(sent.value.version);
    recordActivity(deps, {
      actorId,
      action: "proposal.sent",
      recordType: "proposal",
      recordId: proposalId,
      context: { opportunityId: opportunity.id, version: sent.value.version.number, pricing: sent.value.version.pricing, minor: sent.value.version.total.minor, currency: sent.value.version.total.currency },
    });
    // These cannot fail for a proposal that passed its own checks. If one
    // ever did, throwing undoes the whole send.
    const priced = applyOpportunityValue(deps, actorId, opportunity, sent.value.version.pricing, opportunityValue(sent.value.version));
    if (!priced.ok) throw new Error(`Could not price the opportunity from its proposal: ${priced.error}`);
    if (priced.value.stage === "consulted") {
      const moved = applyStageMove(deps, actorId, priced.value, { to: "quoted" });
      if (!moved.ok) throw new Error(`Could not move the opportunity to quoted: ${moved.error}`);
    }
    return ok(sent.value.version);
  });
}

export type DecideProposalError = Refused | DecisionError | "opportunity-lost";

/**
 * Records the client's answer. Accepting wins the opportunity, starts its
 * project if there is none, and copies the accepted estimate in as the
 * project's baseline, all as one change.
 */
export function recordProposalDecision(deps: ProposalsDeps, actorId: Id | null, proposalId: Id, input: DecisionInput): Result<{ decision: Decision; project: Project | null }, DecideProposalError> {
  if (!allowed(deps, actorId, "proposal.decide")) return err("forbidden");
  return deps.transact(() => {
    const proposal = deps.proposals.get(proposalId);
    if (!proposal) return err("not-found");
    return applyDecision(deps, actorId, proposal, input);
  });
}

/**
 * The decision itself, with no permission check and no transaction, so the
 * client portal can record a client's own answer. Call it inside a
 * transaction, after the calling use case has checked who is asking.
 * `actorId` is null when the client decided for themselves.
 */
export function applyDecision(deps: ProposalsDeps, actorId: Id | null, proposal: Proposal, input: DecisionInput): Result<{ decision: Decision; project: Project | null }, DecisionError | "not-found" | "opportunity-lost"> {
  const at = deps.clock();
  const decided = decideProposal(proposal, input, actorId, at);
  if (!decided.ok) return decided;
  const { decision } = decided.value;
  const opportunity = deps.opportunities.get(proposal.opportunityId);
  const version = deps.proposals.version(proposal.id, decision.version);
  if (!opportunity || !version) return err("not-found");
  if (decision.decision === "accepted" && opportunity.stage === "lost") return err("opportunity-lost");

  deps.proposals.update(decided.value.proposal, at);
  deps.proposals.saveDecision(decision);
  const event = { version: decision.version, byName: decision.byName, on: decision.on, method: decision.method, opportunityId: opportunity.id };
  if (decision.decision === "declined") {
    recordActivity(deps, { actorId, action: "proposal.declined", recordType: "proposal", recordId: proposal.id, context: event });
    return ok({ decision, project: null });
  }

  let won = opportunity;
  if (won.stage !== "won") {
    const moved = applyStageMove(deps, actorId, won, { to: "won" });
    if (!moved.ok) throw new Error(`Could not win the opportunity for its accepted proposal: ${moved.error}`);
    won = moved.value;
  }
  let project = deps.projects.byOpportunity(won.id);
  if (!project) {
    const made = applyConversion(deps, actorId, won);
    if (!made.ok) throw new Error(`Could not start the project for an accepted proposal: ${made.error}`);
    project = made.value;
  }
  applyBaseline(deps, actorId, {
    projectId: project.id,
    proposalId: proposal.id,
    version: version.number,
    pricing: version.pricing,
    amount: version.total,
    minutes: version.minutes,
    lines: version.lines.map((line) => ({ item: line.item, kind: line.kind, quantity: line.quantity, rate: line.rate, total: line.total })),
  });
  recordActivity(deps, { actorId, action: "proposal.accepted", recordType: "proposal", recordId: proposal.id, context: { ...event, projectId: project.id } });
  return ok({ decision, project });
}

export type AgreementError = Refused | "not-accepted" | "invalid-date" | "reference-too-long" | "agreement-needs-reference" | UploadError;

/**
 * Records where the signed agreement is kept (roadmap v0.4), with a scan of
 * it if there is one. Only for an accepted proposal.
 */
export function recordAgreement(
  deps: ProposalsDeps,
  actorId: Id | null,
  proposalId: Id,
  input: { readonly reference?: string | null; readonly signedOn: string; readonly file?: { readonly name: string; readonly bytes: Uint8Array } | null },
): Result<Agreement, AgreementError> {
  if (!allowed(deps, actorId, "proposal.decide")) return err("forbidden");
  const reference = optionalText(input.reference, 500);
  if (!reference.ok) return err("reference-too-long");
  const signedOn = calendarDate(input.signedOn.trim());
  if (!signedOn.ok) return signedOn;
  if (reference.value === null && !input.file) return err("agreement-needs-reference");
  return deps.transact(() => {
    const proposal = deps.proposals.get(proposalId);
    if (!proposal) return err("not-found");
    if (proposal.status !== "accepted") return err("not-accepted");
    const opportunity = deps.opportunities.get(proposal.opportunityId);
    const project = opportunity ? deps.projects.byOpportunity(opportunity.id) : null;
    const id = deps.newId();
    let fileId: Id | null = null;
    if (input.file) {
      const file = saveFile(deps, actorId, { ...input.file, ownerType: "agreement", ownerId: id, organizationId: opportunity?.organizationId ?? null, projectId: project?.id ?? null });
      if (!file.ok) return file;
      fileId = file.value.id;
    }
    const agreement: Agreement = { id, proposalId, version: proposal.currentVersion, reference: reference.value ?? "", signedOn: signedOn.value, fileId, recordedBy: actorId };
    deps.proposals.insertAgreement(agreement, deps.clock());
    recordActivity(deps, {
      actorId,
      action: "agreement.recorded",
      recordType: "agreement",
      recordId: id,
      context: { proposalId, version: agreement.version, signedOn: agreement.signedOn, hasFile: fileId !== null, ...(project ? { projectId: project.id } : {}) },
    });
    return ok(agreement);
  });
}

/** Lets the client see the proposal's sent versions in the portal, or stops. */
export function setProposalShared(deps: ProposalsDeps, actorId: Id | null, proposalId: Id, shared: boolean): Result<Proposal, Refused | "not-sent" | "unchanged"> {
  if (!allowed(deps, actorId, "proposal.send")) return err("forbidden");
  return deps.transact(() => {
    const proposal = deps.proposals.get(proposalId);
    if (!proposal) return err("not-found");
    if (proposal.currentVersion === 0) return err("not-sent");
    if (proposal.sharedWithClient === shared) return err("unchanged");
    const changed = { ...proposal, sharedWithClient: shared };
    deps.proposals.update(changed, deps.clock());
    recordActivity(deps, { actorId, action: shared ? "proposal.shared" : "proposal.unshared", recordType: "proposal", recordId: proposalId, context: { opportunityId: proposal.opportunityId } });
    return ok(changed);
  });
}
