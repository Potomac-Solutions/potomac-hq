// Public entry for AI assistance (decision 0010): settings, budget, usage,
// and the drafts each feature writes for a person to use or discard.
export * from "./application/ai.ts";
export * from "./application/features.ts";
export type { AiModel, AiRecords, AiStore, Draft, ModelAnswer, ModelRequest } from "./application/ports.ts";
export { FEATURE_TEXT, FEATURES, isFeature, type Feature } from "./domain/settings.ts";
export { KNOWN_MODELS, dollarsText } from "./domain/models.ts";
export { MAX_RECEIPT_BYTES } from "./domain/files.ts";
export type { AskDraft, BriefDraft, CaseStudyDraft, DiagnosisDraft, MailDraft, PostsDraft, ProposalDraft, ReceiptDraft, RecapDraft, ScopeDraft, TriageDraft, UpdateDraft } from "./domain/prompts.ts";
