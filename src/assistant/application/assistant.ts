// The assistant on Home (decision 0015, section 4). A message goes to the
// model with the conversation so far; lookups it asks for run straight away
// and go back to it, up to MAX_ROUNDS times; a change it asks for becomes an
// action, which waits for the person's tap (or, when they've allowed it and
// the change is small, runs at once with an undo). Every change runs through
// the module that owns it, as the person, with that module's permission
// checks and events, so the assistant can never do more than they can.
//
// Permissions: anyone signed in may talk to it (AI's own checks decide
// whether it's on); each action is checked by the service that does it.
import { HEALTH_LABELS, historyFor, readWhere, lookedUp, MAX_MESSAGE, MAX_ROUNDS, MOVE_LABELS, readAsk, resultText, segmentsOf, systemPrompt, toolNamed, TOOLS, type Ask, type Block, type Segment } from "../domain/assistant.ts";
import type { IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { AssistantActions, AssistantStore, Done, StoredAction, StoredMessage, Talk, Undo } from "./ports.ts";

export type AssistantDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly store: AssistantStore;
  readonly actions: AssistantActions;
  readonly talk: Talk;
  /** Today as a person reads it, for the model. */
  readonly todayText: () => string;
  /** Whether the assistant can be used now, and why not. */
  readonly state: (actorId: Id) => { readonly on: boolean; readonly why: string };
};

/** How long a small change can be undone. */
const UNDO_HOURS = 24;

const signedIn = (deps: AssistantDeps, actorId: Id | null): actorId is Id => actorId !== null && deps.users.get(actorId)?.status === "active";

// ---- Running a tool -------------------------------------------------------

function lookUp(deps: AssistantDeps, actorId: Id, ask: Ask): string {
  if (ask.tool === "find") return resultText(deps.actions.find(actorId, ask.query));
  if (ask.tool === "knowledge") return resultText(deps.actions.knowledge(actorId, ask.query));
  return resultText(deps.actions.due(actorId));
}

/** What the card says, or why the change can't be offered at all. */
function describe(deps: AssistantDeps, actorId: Id, ask: Ask): Result<string, string> {
  const quote = (text: string, most = 120) => `“${text.length > most ? text.slice(0, most - 1) + "…" : text}”`;
  switch (ask.tool) {
    case "quick_add": {
      const preview = deps.actions.preview(actorId, ask.line);
      return preview.canSave ? ok(preview.says) : err(preview.problem || "Quick add couldn't read that line.");
    }
    case "move_task": {
      const task = deps.actions.task(actorId, ask.taskId as Id);
      if (!task) return err("There's no task with that id that this person may see.");
      return ok(`Move ${quote(task.title)} to ${MOVE_LABELS[ask.to]}`);
    }
    case "tick_off":
    case "reopen": {
      const task = deps.actions.task(actorId, ask.todoId as Id);
      if (!task) return err("There's no to-do or task with that id that this person may see.");
      if (ask.tool === "tick_off" && task.done) return err("That one is already done.");
      if (ask.tool === "reopen" && !task.done) return err("That one isn't done.");
      return ok(`${ask.tool === "tick_off" ? "Tick off" : "Reopen"} ${quote(task.title)}`);
    }
    case "add_note": {
      const record = deps.actions.record(actorId, ask.on, ask.id as Id);
      return record ? ok(`Add a note on ${record.name}: ${quote(ask.note)}`) : err(`There's no ${ask.on} with that id that this person may see.`);
    }
    case "log_contact": {
      const record = ask.opportunityId ? deps.actions.record(actorId, "opportunity", ask.opportunityId as Id) : deps.actions.record(actorId, "client", ask.clientId as Id);
      if (!record) return err("There's no client or deal with that id that this person may see.");
      const what = ask.kind === "call" ? (ask.outcome === "voicemail" ? "a voicemail left" : ask.outcome === "no-answer" ? "a call with no answer" : "a call") : `a ${ask.kind}`;
      return ok(`Log ${what} with ${record.name}${ask.note ? `: ${quote(ask.note)}` : ""}${ask.followUpOn ? `, and follow up on ${ask.followUpOn}` : ""}`);
    }
    case "add_client":
      return ok(`Add a client: ${ask.name}${ask.website ? ` (${ask.website})` : ""}`);
    case "open_deal": {
      const client = deps.actions.record(actorId, "client", ask.clientId as Id);
      return client ? ok(`Open a deal at ${client.name}: ${ask.title}`) : err("There's no client with that id that this person may see.");
    }
    case "set_follow_up": {
      const deal = deps.actions.deal(actorId, ask.opportunityId as Id);
      if (!deal) return err("There's no deal with that id that this person may see.");
      if (!deal.open) return err("That deal is already won or lost.");
      return ok(ask.on ? `Follow up on ${deal.name} on ${ask.on}` : `Clear the follow-up day on ${deal.name}`);
    }
    case "project_health": {
      const project = deps.actions.project(actorId, ask.projectId as Id);
      return project ? ok(`Mark ${project.name} ${HEALTH_LABELS[ask.health].toLowerCase()}`) : err("There's no project with that id that this person may see.");
    }
    case "stop_timer": {
      const running = deps.actions.timer(actorId);
      return running ? ok(`Stop the timer (${running}) and log the time`) : err("No timer is running.");
    }
    case "booking_link":
      return ok(`Make a booking link for ${ask.label}: ${ask.oneTime ? "one call" : "any number of calls"}, ${ask.lasts ? `for ${ask.lasts} days` : "with no end"}. It's shown on Calls to copy; nothing is sent`);
    case "start_proposal": {
      const deal = deps.actions.deal(actorId, ask.opportunityId as Id);
      if (!deal) return err("There's no deal with that id that this person may see.");
      return ok(`Start a draft proposal for ${deal.name}, ${deps.actions.proposalDraftWaiting(actorId, ask.opportunityId as Id) ? "from the AI draft" : "from the service's template"}. Nothing is sent`);
    }
    case "draft_invoice": {
      const project = deps.actions.project(actorId, ask.projectId as Id);
      if (!project) return err("There's no project with that id that this person may see.");
      return ok(`Draft an invoice on ${project.name}: ${ask.description}, $${Number(ask.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${ask.dueOn ? `, due ${ask.dueOn}` : ""}. It stays a draft`);
    }
    default:
      return err("That isn't a change.");
  }
}

/** Does the change, as the person. */
function perform(deps: AssistantDeps, actorId: Id, ask: Ask): Result<Done, string> {
  const a = deps.actions;
  switch (ask.tool) {
    case "quick_add":
      return a.quickAdd(actorId, ask.line);
    case "move_task": {
      const before = a.task(actorId, ask.taskId as Id);
      const moved = a.moveTask(actorId, ask.taskId as Id, ask.to);
      return moved.ok && before ? ok({ ...moved.value, undo: { tool: "move_task", taskId: ask.taskId, to: before.status } }) : moved;
    }
    case "tick_off": {
      const done = a.setDone(actorId, ask.todoId as Id, true);
      return done.ok ? ok({ ...done.value, undo: { tool: "reopen", todoId: ask.todoId } }) : done;
    }
    case "reopen": {
      const done = a.setDone(actorId, ask.todoId as Id, false);
      return done.ok ? ok({ ...done.value, undo: { tool: "tick_off", todoId: ask.todoId } }) : done;
    }
    case "add_note":
      return a.addNote(actorId, ask.on, ask.id as Id, ask.note);
    case "log_contact":
      return a.logContact(actorId, ask.opportunityId ? { opportunityId: ask.opportunityId as Id } : { clientId: ask.clientId as Id }, ask);
    case "add_client":
      return a.addClient(actorId, ask);
    case "open_deal":
      return a.openDeal(actorId, ask.clientId as Id, ask);
    case "set_follow_up": {
      const before = a.deal(actorId, ask.opportunityId as Id);
      const set = a.setFollowUp(actorId, ask.opportunityId as Id, ask.on);
      return set.ok && before ? ok({ ...set.value, undo: { tool: "set_follow_up", opportunityId: ask.opportunityId, on: before.followUpOn } }) : set;
    }
    case "project_health": {
      const before = a.project(actorId, ask.projectId as Id);
      const set = a.setHealth(actorId, ask.projectId as Id, ask.health);
      return set.ok && before ? ok({ ...set.value, undo: { tool: "project_health", projectId: ask.projectId, health: before.health } }) : set;
    }
    case "stop_timer":
      return a.stopTimer(actorId);
    case "booking_link":
      return a.bookingLink(actorId, ask);
    case "start_proposal":
      return a.startProposal(actorId, ask.opportunityId as Id);
    case "draft_invoice":
      return a.draftInvoice(actorId, ask.projectId as Id, ask);
    default:
      return err("That isn't a change.");
  }
}

function runUndo(deps: AssistantDeps, actorId: Id, undo: Undo): Result<Done, string> {
  if (undo.tool === "move_task") return deps.actions.moveTask(actorId, undo.taskId as Id, undo.to);
  if (undo.tool === "set_follow_up") return deps.actions.setFollowUp(actorId, undo.opportunityId as Id, undo.on);
  if (undo.tool === "project_health") return deps.actions.setHealth(actorId, undo.projectId as Id, undo.health);
  return deps.actions.setDone(actorId, undo.todoId as Id, undo.tool === "tick_off");
}

/** A note from HQ in the conversation: what came of a card. The model reads it next time. */
function note(deps: AssistantDeps, actorId: Id, text: string): void {
  deps.store.addMessage(actorId, { id: deps.newId(), role: "assistant", content: [{ type: "text", text }], at: deps.clock() });
}

// ---- A message ------------------------------------------------------------

export type SendProblem = "forbidden" | "message-missing" | "assistant-off" | string;

/** What came of a message: how many rounds it took, and the changes waiting for a tap. */
export type Sent = { readonly rounds: number; readonly waiting: number; readonly done: number };

/** `pick` is the model picked beside the box; anything not allowed is the usual model. `from` is the page it was sent from. */
export async function sendMessage(deps: AssistantDeps, actorId: Id | null, typed: string, pick = "", from = ""): Promise<Result<Sent, SendProblem>> {
  if (!signedIn(deps, actorId)) return err("forbidden");
  const text = typed.replace(/\r\n/g, "\n").trim();
  if (!text || text.length > MAX_MESSAGE) return err("message-missing");
  const state = deps.state(actorId);
  if (!state.on) return err("assistant-off");
  const user = deps.users.get(actorId);
  const autoSmall = deps.store.autoSmall(actorId);
  deps.store.addMessage(actorId, { id: deps.newId(), role: "user", content: [{ type: "text", text }], at: deps.clock() });

  const system = systemPrompt({ name: user?.name ?? "someone", today: deps.todayText(), autoSmall, where: readWhere(from) });
  let rounds = 0;
  let waiting = 0;
  let done = 0;
  for (;;) {
    rounds += 1;
    const answer = await deps.talk(actorId, pick, { system, messages: historyFor(deps.store.messages(actorId)), tools: TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema })), maxOutput: 1024 });
    if (!answer.ok) {
      recordActivity(deps, { actorId, action: "assistant.failed", recordType: "user", recordId: actorId, context: { rounds, problem: answer.error } });
      return err(answer.error);
    }
    const blocks = answer.value.blocks;
    deps.store.addMessage(actorId, { id: deps.newId(), role: "assistant", content: blocks, at: deps.clock() });
    const uses = blocks.filter((block): block is Extract<Block, { type: "tool_use" }> => block.type === "tool_use");
    if (uses.length === 0) break;

    let stop = false;
    const results: Block[] = [];
    // Not one transaction: each change is its own module's, in its own.
    {
      for (const use of uses) {
        const tool = toolNamed(use.name);
        const ask = readAsk(use.name, use.input);
        if (!tool || !ask.ok) {
          results.push({ type: "tool_result", tool_use_id: use.id, content: ask.ok ? "Unknown tool." : ask.error, is_error: true });
          continue;
        }
        if (tool.kind === "look") {
          results.push({ type: "tool_result", tool_use_id: use.id, content: lookUp(deps, actorId, ask.value) });
          continue;
        }
        const summary = describe(deps, actorId, ask.value);
        if (!summary.ok) {
          results.push({ type: "tool_result", tool_use_id: use.id, content: summary.error, is_error: true });
          continue;
        }
        const action: StoredAction = { id: deps.newId(), userId: actorId, toolUseId: use.id, ask: ask.value, summary: summary.value, status: "waiting", href: "", problem: "", undo: null, createdAt: deps.clock(), decidedAt: null };
        deps.store.addAction(action);
        if (tool.kind === "small" && autoSmall) {
          const outcome = settle(deps, actorId, action);
          done += outcome.ok ? 1 : 0;
          results.push(outcome.ok ? { type: "tool_result", tool_use_id: use.id, content: `Done (it can be undone from the conversation): ${summary.value}.` } : { type: "tool_result", tool_use_id: use.id, content: `It didn't work: ${outcome.error}`, is_error: true });
          continue;
        }
        waiting += 1;
        stop = true;
        results.push({ type: "tool_result", tool_use_id: use.id, content: `Shown to ${user?.name ?? "them"} as a card: ${summary.value}. It happens only if they tap Do it. Don't ask again.` });
      }
      deps.store.addMessage(actorId, { id: deps.newId(), role: "user", content: results, at: deps.clock() });
    }
    // A card waits for the person; more lookups would only spend.
    if (stop) break;
    if (rounds >= MAX_ROUNDS) {
      note(deps, actorId, "That took more lookups than one message is allowed. Ask again, a little more narrowly.");
      break;
    }
  }
  recordActivity(deps, { actorId, action: "assistant.asked", recordType: "user", recordId: actorId, context: { rounds, waiting, done } });
  return ok({ rounds, waiting, done });
}

/**
 * Runs a waiting action, then records what came of it. The change itself is
 * its module's, in that module's own transaction (they don't nest), so the
 * record of it follows in one of its own.
 */
function settle(deps: AssistantDeps, actorId: Id, action: StoredAction, then?: (outcome: Result<Done, string>) => void): Result<Done, string> {
  const outcome = perform(deps, actorId, action.ask);
  deps.transact(() => {
    const at = deps.clock();
    if (outcome.ok) {
      deps.store.settle(action.id, { status: "done", href: outcome.value.href, undo: outcome.value.undo ?? null, at });
      recordActivity(deps, { actorId, action: "assistant.acted", recordType: "assistant-action", recordId: action.id, context: { tool: action.ask.tool, href: outcome.value.href } });
    } else {
      deps.store.settle(action.id, { status: "failed", problem: outcome.error.slice(0, 300), at });
      recordActivity(deps, { actorId, action: "assistant.action-failed", recordType: "assistant-action", recordId: action.id, context: { tool: action.ask.tool, problem: outcome.error.slice(0, 200) } });
    }
    then?.(outcome);
  });
  return outcome;
}

type Owned = Result<StoredAction, "forbidden" | "not-found" | "already-decided">;

function owned(deps: AssistantDeps, actorId: Id | null, id: Id, status: StoredAction["status"]): Owned {
  if (!signedIn(deps, actorId)) return err("forbidden");
  const action = deps.store.action(id);
  if (!action || action.userId !== actorId) return err("not-found");
  return action.status === status ? ok(action) : err("already-decided");
}

/** Do it: the card's change, as the person. */
export function confirmAction(deps: AssistantDeps, actorId: Id | null, id: Id): Result<Done, string> {
  const found = owned(deps, actorId, id, "waiting");
  if (!found.ok) return found;
  return settle(deps, actorId as Id, found.value, (outcome) => note(deps, actorId as Id, outcome.ok ? `Done: ${found.value.summary}.` : `That didn't work: ${outcome.error}`));
}

export function cancelAction(deps: AssistantDeps, actorId: Id | null, id: Id): Result<StoredAction, string> {
  const found = owned(deps, actorId, id, "waiting");
  if (!found.ok) return found;
  return deps.transact(() => {
    deps.store.settle(id, { status: "cancelled", at: deps.clock() });
    recordActivity(deps, { actorId, action: "assistant.cancelled", recordType: "assistant-action", recordId: id, context: { tool: found.value.ask.tool } });
    note(deps, actorId as Id, `Cancelled: ${found.value.summary}.`);
    return ok(found.value);
  });
}

/** Undo: a small change put back, within a day. */
export function undoAction(deps: AssistantDeps, actorId: Id | null, id: Id): Result<Done, string> {
  const found = owned(deps, actorId, id, "done");
  if (!found.ok) return found;
  const action = found.value;
  if (!action.undo || !action.decidedAt) return err("cant-undo");
  if (Date.parse(deps.clock()) - Date.parse(action.decidedAt) > UNDO_HOURS * 3_600_000) return err("too-late");
  const outcome = runUndo(deps, actorId as Id, action.undo);
  if (!outcome.ok) return outcome;
  deps.transact(() => {
    deps.store.settle(id, { status: "undone", at: deps.clock() });
    recordActivity(deps, { actorId, action: "assistant.undone", recordType: "assistant-action", recordId: id, context: { tool: action.ask.tool } });
    note(deps, actorId as Id, `Undone: ${action.summary}.`);
  });
  return outcome;
}

/** New chat: the conversation so far is archived, and cards still waiting are cancelled. */
export function newChat(deps: AssistantDeps, actorId: Id | null): Result<number, "forbidden"> {
  if (!signedIn(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const uses = deps.store.messages(actorId).flatMap((message) => message.content.flatMap((block) => (block.type === "tool_use" ? [block.id] : [])));
    for (const action of deps.store.actionsFor(actorId, uses)) if (action.status === "waiting") deps.store.settle(action.id, { status: "cancelled", at: deps.clock() });
    const archived = deps.store.archive(actorId);
    recordActivity(deps, { actorId, action: "assistant.new-chat", recordType: "user", recordId: actorId, context: { archived } });
    return ok(archived);
  });
}

export function setAutoSmall(deps: AssistantDeps, actorId: Id | null, on: boolean): Result<boolean, "forbidden"> {
  if (!signedIn(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    deps.store.setAutoSmall(actorId, on, deps.clock());
    recordActivity(deps, { actorId, action: "assistant.preference-set", recordType: "user", recordId: actorId, context: { autoSmall: on } });
    return ok(on);
  });
}

// ---- What Home shows ------------------------------------------------------

export type ChatCard = {
  readonly id: string;
  readonly summary: string;
  readonly status: StoredAction["status"];
  readonly statusText: string;
  readonly href: string;
  readonly problem: string;
  readonly canUndo: boolean;
};

export type ChatLine =
  | { readonly key: string; readonly who: "you"; readonly text: string }
  | { readonly key: string; readonly who: "hq"; readonly segments: readonly Segment[] }
  | { readonly key: string; readonly who: "looked"; readonly text: string }
  | { readonly key: string; readonly who: "card"; readonly card: ChatCard };

export type ChatView = {
  readonly on: boolean;
  /** Why it's off, when it is: no key, the feature off, or the budget spent. */
  readonly why: string;
  readonly lines: readonly ChatLine[];
  readonly autoSmall: boolean;
  /** Ideas for a first message. */
  readonly suggestions: readonly string[];
};

const STATUS_TEXT: Readonly<Record<StoredAction["status"], string>> = { waiting: "Waiting for you", done: "Done", cancelled: "Cancelled", failed: "Didn't work", undone: "Undone" };

const SUGGESTIONS = ["Do the first one", "Add a to-do to call Stacy Friday", "Where do I set my booking hours?", "Log a call with Nu-Finish about their landing page"];

export function chatView(deps: AssistantDeps, actorId: Id | null): ChatView {
  if (!signedIn(deps, actorId)) return { on: false, why: "", lines: [], autoSmall: false, suggestions: [] };
  const state = deps.state(actorId);
  const messages: StoredMessage[] = deps.store.messages(actorId);
  const uses = messages.flatMap((message) => message.content.flatMap((block) => (block.type === "tool_use" ? [block.id] : [])));
  const actions = new Map(deps.store.actionsFor(actorId, uses).map((action) => [action.toolUseId, action]));
  const now = Date.parse(deps.clock());
  const lines: ChatLine[] = [];
  for (const message of messages) {
    message.content.forEach((block, index) => {
      const key = `${message.id}-${index}`;
      if (block.type === "text") lines.push(message.role === "user" ? { key, who: "you", text: block.text } : { key, who: "hq", segments: segmentsOf(block.text) });
      else if (block.type === "tool_use") {
        const action = actions.get(block.id);
        if (action) {
          const canUndo = action.status === "done" && action.undo !== null && action.decidedAt !== null && now - Date.parse(action.decidedAt) <= UNDO_HOURS * 3_600_000;
          lines.push({ key, who: "card", card: { id: action.id, summary: action.summary, status: action.status, statusText: STATUS_TEXT[action.status], href: action.href, problem: action.problem, canUndo } });
        } else if (toolNamed(block.name)?.kind === "look") lines.push({ key, who: "looked", text: lookedUp(block.name, block.input) });
      }
    });
  }
  // The day, from HQ's own records: no model, no budget.
  const brief = state.on ? deps.actions.brief(actorId) : "";
  const all: ChatLine[] = brief ? [{ key: "brief", who: "hq", segments: segmentsOf(brief) }, ...lines] : lines;
  return { on: state.on, why: state.why, lines: all, autoSmall: deps.store.autoSmall(actorId), suggestions: lines.length === 0 ? SUGGESTIONS : [] };
}
export { readWhere } from "../domain/assistant.ts";
