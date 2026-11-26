import type { AiSettings, Feature } from "../domain/settings.ts";
import type { Attachment } from "../domain/prompts.ts";
import type { Id } from "../../shared/index.ts";

export type ModelRequest = {
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly maxOutput: number;
  readonly attachments?: readonly Attachment[];
};

export type ModelAnswer =
  | { readonly ok: true; readonly text: string; readonly inputCount: number; readonly outputCount: number }
  /** No answer: why, in a few words, and anything it was charged for. */
  | { readonly ok: false; readonly problem: string; readonly inputCount: number; readonly outputCount: number };

/** One block of a conversation, as Claude's Messages API has them (decision 0015). */
export type ChatBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_use"; readonly id: string; readonly name: string; readonly input: Readonly<Record<string, unknown>> }
  | { readonly type: "tool_result"; readonly tool_use_id: string; readonly content: string; readonly is_error?: boolean };

export type ChatMessage = { readonly role: "user" | "assistant"; readonly content: readonly ChatBlock[] };

/** A tool the model may use: its name, what it's for, and its input as JSON Schema. */
export type ChatTool = { readonly name: string; readonly description: string; readonly input_schema: Readonly<Record<string, unknown>> };

export type ConverseRequest = {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ChatTool[];
  readonly maxOutput: number;
};

export type ConverseAnswer =
  | { readonly ok: true; readonly blocks: readonly ChatBlock[]; readonly stopReason: string; readonly inputCount: number; readonly outputCount: number }
  | { readonly ok: false; readonly problem: string; readonly inputCount: number; readonly outputCount: number };

/** Claude, or a stand-in in tests. Never throws. `converse` is a conversation with tools; a stand-in may leave it out. */
export type AiModel = { ask(request: ModelRequest): Promise<ModelAnswer>; converse?(request: ConverseRequest): Promise<ConverseAnswer> };

export type StoredSettings = AiSettings & { readonly updatedBy: Id | null; readonly updatedAt: string };

export type UsageRow = {
  readonly id: Id;
  readonly feature: Feature;
  readonly recordType: string;
  readonly recordId: string;
  readonly model: string;
  readonly inputCount: number;
  readonly outputCount: number;
  /** Millionths of a dollar. */
  readonly cost: number;
  readonly actorId: Id | null;
  readonly at: string;
  readonly ok: boolean;
  readonly problem: string;
  readonly draftId: Id | null;
};

export type DraftStatus = "waiting" | "used" | "discarded";

export type Draft = {
  readonly id: Id;
  readonly feature: Feature;
  readonly recordType: string;
  readonly recordId: string;
  /** The feature's draft, as read from the answer. */
  readonly content: unknown;
  readonly status: DraftStatus;
  readonly fingerprint: string;
  readonly createdBy: Id | null;
  readonly createdAt: string;
  readonly decidedBy: Id | null;
  readonly decidedAt: string | null;
  readonly hasAttachment: boolean;
};

export type AiStore = {
  settings(): StoredSettings;
  saveSettings(settings: AiSettings, by: Id, at: string): void;
  logUsage(row: UsageRow): void;
  /** What calls cost since an instant, in millionths of a dollar. */
  spentSince(since: string): number;
  countSince(since: string): { readonly calls: number; readonly failed: number };
  recentUsage(limit: number): UsageRow[];
  insertDraft(draft: Draft, attachment?: { readonly name: string; readonly bytes: Uint8Array } | null): void;
  getDraft(id: Id): Draft | null;
  /** The newest draft of a feature for a record, whatever its status. */
  latest(feature: Feature, recordId: string): Draft | null;
  /** Drafts still waiting, newest first. */
  waiting(limit: number): Draft[];
  /** A feature's drafts still waiting for one record, newest first. */
  waitingFor(feature: Feature, recordId: string): Draft[];
  /** Whether a feature already wrote a draft from these records, whatever became of it. */
  hasFingerprint(feature: Feature, fingerprint: string): boolean;
  /** Marks a waiting draft used or discarded, and lets its picture go. False when it wasn't waiting. */
  decide(id: Id, status: "used" | "discarded", by: Id | null, at: string): boolean;
  attachment(id: Id): { readonly name: string; readonly bytes: Uint8Array } | null;
};

/** An opportunity and who it's with, as AI features read it. */
export type DealFacts = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly client: string;
  readonly contactId: Id | null;
  readonly contact: string;
  readonly contactEmail: string;
  readonly ownerId: Id;
  readonly title: string;
  readonly service: string | null;
  readonly summary: string;
  readonly stage: string;
  readonly leadSource: string;
  readonly createdAt: string;
};

export type ProjectFacts = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly client: string;
  readonly name: string;
  readonly status: string;
  readonly ownerId: Id;
  readonly service: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The accepted proposal's last version, if there is one. */
  readonly agreed: { readonly scope: string; readonly deliverables: string; readonly exclusions: string; readonly lines: readonly string[] } | null;
  /** Change requests, approved or waiting, by title. */
  readonly changes: readonly string[];
  readonly milestones: readonly { readonly name: string; readonly dueOn: string | null; readonly doneOn: string | null }[];
  /** Links shared with the client. */
  readonly sharedLinks: readonly string[];
};

/** What AI reads straight from HQ's tables. Read-only: changes go through each module's own services. */
export type AiRecords = {
  deal(id: Id): DealFacts | null;
  /** The newest notes from calls and messages on a deal or at a client, newest first. */
  touches(where: { readonly opportunityId: Id } | { readonly organizationId: Id }, limit: number): { readonly at: string; readonly kind: string; readonly note: string }[];
  /** Deals not yet triaged: new, made since an instant, at real clients (not demos). */
  untriaged(since: string, triaged: (id: Id) => boolean): Id[];
  project(id: Id): ProjectFacts | null;
  /** Finished projects of a service, with hours estimated (budget) against hours logged. */
  similarJobs(service: string, limit: number): { readonly project: string; readonly estimatedHours: number; readonly actualHours: number }[];
  /** A project's tasks done in a window, open tasks due soon, and tasks or deliverables waiting on the client. */
  week(projectId: Id, from: string, to: string, nextUntil: string): { readonly done: readonly string[]; readonly next: readonly string[]; readonly waitingOnClient: readonly string[] };
  /** Active projects, for the weekly updates. */
  activeProjects(): Id[];
  /** Messages clients sent since an instant, at real clients. */
  clientMessages(since: string): { readonly id: Id; readonly projectId: Id; readonly body: string; readonly at: string }[];
  /** Current articles and decisions that best match the words, most matches first. */
  articles(words: readonly string[], limit: number): { readonly slug: string; readonly title: string; readonly body: string }[];
  /** A watched site by its address, with its last result and recent outages. */
  site(url: string): { readonly id: Id; readonly organizationId: Id; readonly url: string; readonly lastResult: string; readonly certExpiresOn: string; readonly outages: readonly string[] } | null;
  userName(id: Id): string;
};
