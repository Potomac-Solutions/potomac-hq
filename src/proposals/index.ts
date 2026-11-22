// Public entry for proposals and estimates: drafts from a template per
// service, sent as versions that never change, accepted into a project.
export { depositFor, formatQuantity, LINE_KINDS, MAX_LINES, summarize, type EstimateLine, type LineInput } from "./domain/estimate.ts";
export { DECISION_METHODS, PROPOSAL_STATUSES, type Decision, type DecisionInput, type Proposal, type ProposalInput, type ProposalStatus, type ProposalVersion } from "./domain/proposal.ts";
export { TEMPLATE_OPTIONS, TEMPLATES } from "./domain/templates.ts";
export type { Agreement, ProposalRow, ProposalStore } from "./application/ports.ts";
export * from "./application/commands.ts";
export * from "./application/queries.ts";
