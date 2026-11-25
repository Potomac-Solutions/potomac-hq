import type { Ask, Block, Message } from "../domain/assistant.ts";
import type { Id, Result } from "../../shared/index.ts";

export type StoredMessage = Message & { readonly id: Id; readonly at: string };

export type ActionStatus = "waiting" | "done" | "cancelled" | "failed" | "undone";

/** How to put a small change back: the tool that does it and what it's given. */
export type Undo =
  | { readonly tool: "move_task"; readonly taskId: string; readonly to: string }
  | { readonly tool: "tick_off" | "reopen"; readonly todoId: string }
  | { readonly tool: "set_follow_up"; readonly opportunityId: string; readonly on: string }
  | { readonly tool: "project_health"; readonly projectId: string; readonly health: string };

export type StoredAction = {
  readonly id: Id;
  readonly userId: Id;
  readonly toolUseId: string;
  readonly ask: Ask;
  readonly summary: string;
  readonly status: ActionStatus;
  readonly href: string;
  readonly problem: string;
  readonly undo: Undo | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
};

export type AssistantStore = {
  /** The running conversation, oldest first. */
  messages(userId: Id): StoredMessage[];
  addMessage(userId: Id, message: StoredMessage): void;
  /** New chat: what came before is archived. */
  archive(userId: Id): number;
  addAction(action: StoredAction): void;
  action(id: Id): StoredAction | null;
  /** Actions on the running conversation's tool uses. */
  actionsFor(userId: Id, toolUseIds: readonly string[]): StoredAction[];
  settle(id: Id, change: { readonly status: ActionStatus; readonly href?: string; readonly problem?: string; readonly undo?: Undo | null; readonly at: string }): void;
  autoSmall(userId: Id): boolean;
  setAutoSmall(userId: Id, on: boolean, at: string): void;
};

/** What came of a change: where to see it, and how to undo it if it can be. */
export type Done = { readonly href: string; readonly undo?: Undo | null };

/**
 * What the assistant may do, each through the module that owns it, with that
 * module's own permission checks and activity events. Read-only lookups
 * return plain data for the model; changes return where to see the result.
 */
export type AssistantActions = {
  find(actorId: Id, query: string): unknown;
  /** The day in a sentence or two, from HQ's own records, with [links](/address): who's waiting, what's due, the next call. */
  brief(actorId: Id): string;
  due(actorId: Id): unknown;
  knowledge(actorId: Id, query: string): unknown;
  /** Quick add's reading of a line, for the card: what it will add, or why it can't. */
  preview(actorId: Id, line: string): { readonly canSave: boolean; readonly says: string; readonly problem: string };
  quickAdd(actorId: Id, line: string): Result<Done, string>;
  /** A task or to-do by id: its title, status and page; null if there's none this person may see. */
  task(actorId: Id, id: Id): { readonly title: string; readonly status: string; readonly done: boolean; readonly href: string } | null;
  moveTask(actorId: Id, id: Id, to: string): Result<Done, string>;
  setDone(actorId: Id, id: Id, done: boolean): Result<Done, string>;
  /** A client's, deal's or project's name and page; null if there's none this person may see. */
  record(actorId: Id, on: "client" | "opportunity" | "project", id: Id): { readonly name: string; readonly href: string } | null;
  addNote(actorId: Id, on: "client" | "opportunity" | "project", id: Id, note: string): Result<Done, string>;
  logContact(actorId: Id, where: { readonly clientId: Id } | { readonly opportunityId: Id }, input: { readonly kind: string; readonly outcome: string; readonly note: string; readonly followUpOn: string }): Result<Done, string>;
  addClient(actorId: Id, input: { readonly name: string; readonly website: string; readonly phone: string; readonly address: string }): Result<Done, string>;
  openDeal(actorId: Id, clientId: Id, input: { readonly title: string; readonly leadSource: string; readonly service: string; readonly summary: string }): Result<Done, string>;
  /** A deal's title, client and follow-up day ("" for none); null if there's none this person may see. */
  deal(actorId: Id, id: Id): { readonly name: string; readonly followUpOn: string; readonly open: boolean } | null;
  setFollowUp(actorId: Id, id: Id, on: string): Result<Done, string>;
  /** A project's name and health; null if there's none this person may see. */
  project(actorId: Id, id: Id): { readonly name: string; readonly health: string } | null;
  setHealth(actorId: Id, id: Id, health: string): Result<Done, string>;
  /** The running timer, in words ("Set up hosting, 25 min"), or "" when none runs. */
  timer(actorId: Id): string;
  stopTimer(actorId: Id): Result<Done, string>;
  bookingLink(actorId: Id, input: { readonly label: string; readonly lasts: string; readonly oneTime: boolean }): Result<Done, string>;
  /** Whether an AI proposal draft waits for the deal, so the card can say which it starts from. */
  proposalDraftWaiting(actorId: Id, opportunityId: Id): boolean;
  startProposal(actorId: Id, opportunityId: Id): Result<Done, string>;
  draftInvoice(actorId: Id, projectId: Id, input: { readonly kind: string; readonly description: string; readonly amount: string; readonly dueOn: string }): Result<Done, string>;
};

/** One turn with the model, through AI's checks and budget, with the model picked (up to the ceiling). The error is a problem code from the AI module. */
export type Talk = (
  actorId: Id,
  pick: string,
  request: { readonly system: string; readonly messages: readonly Message[]; readonly tools: readonly { readonly name: string; readonly description: string; readonly input_schema: Readonly<Record<string, unknown>> }[]; readonly maxOutput: number },
) => Promise<Result<{ readonly blocks: readonly Block[] }, string>>;
