import type { Decision, Proposal, ProposalVersion } from "../domain/proposal.ts";
import type { Id } from "../../shared/index.ts";

/** Where the signed agreement for an accepted proposal is kept. */
export type Agreement = {
  readonly id: Id;
  readonly proposalId: Id;
  readonly version: number;
  /** Words for where the signed copy lives: "Filing cabinet, Bakery folder". */
  readonly reference: string;
  readonly signedOn: string;
  /** A scan of it, if one was uploaded. */
  readonly fileId: Id | null;
  readonly recordedBy: Id;
};

export type ProposalRow = Proposal & { readonly opportunityTitle: string; readonly clientId: Id; readonly clientName: string };

export type ProposalStore = {
  insert(proposal: Proposal, at: string): void;
  update(proposal: Proposal, at: string): void;
  get(id: Id): Proposal | null;
  /** An opportunity's proposals, newest first. */
  listFor(opportunityId: Id): Proposal[];
  /** Every proposal with its opportunity's and client's names, newest first. */
  list(): ProposalRow[];
  /** A client's proposals that are shared with them, newest first. */
  sharedWith(organizationId: Id): ProposalRow[];
  insertVersion(version: ProposalVersion): void;
  /** A proposal's versions, newest first. */
  versions(proposalId: Id): ProposalVersion[];
  version(proposalId: Id, number: number): ProposalVersion | null;
  saveDecision(decision: Decision): void;
  decision(proposalId: Id): Decision | null;
  insertAgreement(agreement: Agreement, at: string): void;
  agreements(proposalId: Id): (Agreement & { readonly fileName: string | null })[];
};
