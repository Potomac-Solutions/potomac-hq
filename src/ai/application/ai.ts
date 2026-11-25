// AI assistance, Phase 0 of decision 0010: the settings, the budget, the log
// of every call and the drafts. Every feature runs through `draftWith`, which
// checks that the feature is on, that HQ has a key and that the month's budget
// has room for the most the call could cost; asks the model; logs the call
// and its cost; and keeps what came back as a draft for a person to use or
// discard. AI never acts by itself.
//
// Permissions: `ai.manage` (admins) for the settings and the usage page. A
// draft is asked for, seen and used with the permission the finished thing
// needs (FEATURE_PERMISSION), so AI gives no one more than they already have.
import { costOf, dollarsText, KNOWN_MODELS, knownModel } from "../domain/models.ts";
import { budgetState, FEATURE_TEXT, FEATURES, isFeature, mayCall, readSettings, type AiSettings, type BudgetState, type Feature, type SettingsError, type SettingsInput } from "../domain/settings.ts";
import type { AnswerError, Prompt } from "../domain/prompts.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type ActivityLog, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { AiModel, AiStore, Draft, UsageRow } from "./ports.ts";

export type AiDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly ai: AiStore;
  /** Null when HQ has no API key: nothing can be asked. */
  readonly model: AiModel | null;
  /** The first instant of this month in the business time zone. */
  readonly monthStart: () => string;
  readonly formatWhen: (instant: string) => string;
};

/** What a person needs to ask for, see and use each feature's drafts. */
export const FEATURE_PERMISSION: { readonly [K in Feature]: readonly string[] } = {
  "call-recap": ["contact.edit"],
  "call-brief": ["contact.edit"],
  "lead-triage": ["opportunity.edit", "contact.edit"],
  "check-in": ["opportunity.edit", "contact.edit"],
  "proposal-draft": ["proposal.edit"],
  "scope-check": ["finance.edit"],
  "weekly-update": ["project.post-update"],
  ask: ["knowledge.view"],
  receipt: ["expense.edit"],
  "site-diagnosis": ["client.view"],
  "case-study": ["project.edit"],
  "social-posts": ["project.edit"],
};

export type AiProblem = "forbidden" | "not-found" | "no-key" | "feature-off" | "budget-reached" | "ai-unavailable" | AnswerError;

const may = (deps: Pick<AiDeps, "users">, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;

/** Whether someone may use a feature: its permissions. HQ itself (null) may, for the jobs that run by themselves. */
export const mayUse = (deps: Pick<AiDeps, "users">, actorId: Id | null, feature: Feature): boolean => actorId === null || FEATURE_PERMISSION[feature].every((one) => may(deps, actorId, one));

/** Whether a feature can be asked for right now: on, with a key. The budget is checked when it's asked. */
export const featureOn = (deps: Pick<AiDeps, "ai" | "model">, feature: Feature): boolean => deps.model !== null && deps.ai.settings().features.includes(feature);

/** What the most a prompt could cost: its words at about three characters a token, a picture at 5,000, and the longest answer. */
function mostItCouldCost(settings: AiSettings, prompt: Prompt): number {
  const inputCount = Math.ceil((prompt.system.length + prompt.user.length) / 3) + (prompt.attachments?.length ?? 0) * 5000;
  return costOf(settings.price, inputCount, prompt.maxOutput);
}

export type DraftRequest<T> = {
  readonly feature: Feature;
  readonly recordType: string;
  readonly recordId: string;
  readonly prompt: Prompt;
  readonly read: (answer: string) => Result<T, AnswerError>;
  /** Which records it was written from, so a page can say when they've changed. */
  readonly fingerprint?: string;
  /** A receipt's picture, kept until the draft is used or discarded. */
  readonly attachment?: { readonly name: string; readonly bytes: Uint8Array } | null;
};

export type Drafted<T> = Draft & { readonly content: T };

/**
 * Asks the model for a draft. The caller has already checked the person may
 * use the feature on this record. The call is logged and costed whether or
 * not a usable answer came back.
 */
export async function draftWith<T>(deps: AiDeps, actorId: Id | null, request: DraftRequest<T>): Promise<Result<Drafted<T>, AiProblem>> {
  if (!mayUse(deps, actorId, request.feature)) return err("forbidden");
  const settings = deps.ai.settings();
  if (!deps.model) return err("no-key");
  if (!settings.features.includes(request.feature)) return err("feature-off");
  if (!mayCall(deps.ai.spentSince(deps.monthStart()), settings.budgetMinor, mostItCouldCost(settings, request.prompt))) return err("budget-reached");
  const answer = await deps.model.ask({ model: settings.model, system: request.prompt.system, user: request.prompt.user, maxOutput: request.prompt.maxOutput, ...(request.prompt.attachments ? { attachments: request.prompt.attachments } : {}) });
  const read = answer.ok ? request.read(answer.text) : null;
  const cost = costOf(settings.price, answer.inputCount, answer.outputCount);
  return deps.transact(() => {
    const at = deps.clock();
    const draftId = read?.ok ? deps.newId() : null;
    const problem = !answer.ok ? answer.problem.slice(0, 200) : read && !read.ok ? "The answer didn't fit what was asked." : "";
    const usage: UsageRow = { id: deps.newId(), feature: request.feature, recordType: request.recordType, recordId: request.recordId, model: settings.model, inputCount: answer.inputCount, outputCount: answer.outputCount, cost, actorId, at, ok: draftId !== null, problem, draftId };
    deps.ai.logUsage(usage);
    const context = { feature: request.feature, model: settings.model, in: answer.inputCount, out: answer.outputCount, cost, recordType: request.recordType, recordId: request.recordId };
    if (!read?.ok || draftId === null) {
      recordActivity(deps, { actorId, action: "ai.failed", recordType: "ai-usage", recordId: usage.id, context: { ...context, problem } });
      return err(answer.ok ? "bad-answer" : "ai-unavailable");
    }
    const draft: Drafted<T> = { id: draftId, feature: request.feature, recordType: request.recordType, recordId: request.recordId, content: read.value, status: "waiting", fingerprint: request.fingerprint ?? "", createdBy: actorId, createdAt: at, decidedBy: null, decidedAt: null, hasAttachment: Boolean(request.attachment) };
    deps.ai.insertDraft(draft, request.attachment ?? null);
    recordActivity(deps, { actorId, action: "ai.drafted", recordType: "ai-draft", recordId: draftId, context });
    return ok(draft);
  });
}

/** The newest draft of a feature for a record, for someone who may see it; null otherwise. */
export function latestDraft<T>(deps: AiDeps, actorId: Id | null, feature: Feature, recordId: string): Drafted<T> | null {
  if (actorId === null || !mayUse(deps, actorId, feature)) return null;
  return deps.ai.latest(feature, recordId) as Drafted<T> | null;
}

/** A draft someone may act on: theirs to see, and still waiting. */
export function openDraft(deps: AiDeps, actorId: Id | null, draftId: Id, feature?: Feature): Result<Draft, "forbidden" | "not-found" | "already-decided"> {
  const draft = deps.ai.getDraft(draftId);
  if (!draft || (feature && draft.feature !== feature)) return err("not-found");
  if (!mayUse(deps, actorId, draft.feature) || actorId === null) return err("forbidden");
  if (draft.status !== "waiting") return err("already-decided");
  return ok(draft);
}

/** Marks a draft used or discarded, inside the caller's transaction. */
export function settleDraft(deps: AiDeps, actorId: Id, draft: Draft, status: "used" | "discarded"): void {
  if (!deps.ai.decide(draft.id, status, actorId, deps.clock())) return;
  recordActivity(deps, { actorId, action: status === "used" ? "ai.draft-used" : "ai.draft-discarded", recordType: "ai-draft", recordId: draft.id, context: { feature: draft.feature, recordType: draft.recordType, recordId: draft.recordId } });
}

/** Discards a draft: it stays in the log, and goes from the lists. */
export function discardDraft(deps: AiDeps, actorId: Id | null, draftId: Id): Result<Draft, "forbidden" | "not-found" | "already-decided"> {
  const found = openDraft(deps, actorId, draftId);
  if (!found.ok) return found;
  return deps.transact(() => {
    settleDraft(deps, actorId as Id, found.value, "discarded");
    return ok(found.value);
  });
}

/** Marks a draft used when what it was for was done by hand, like a recap sent from the form it filled. */
export function draftDone(deps: AiDeps, actorId: Id | null, draftId: Id): Result<Draft, "forbidden" | "not-found" | "already-decided"> {
  const found = openDraft(deps, actorId, draftId);
  if (!found.ok) return found;
  return deps.transact(() => {
    settleDraft(deps, actorId as Id, found.value, "used");
    return ok(found.value);
  });
}

// ---- Settings and usage (admins) ------------------------------------------

export type AiSettingsView = {
  readonly keySet: boolean;
  readonly model: string;
  readonly models: readonly { readonly value: string; readonly label: string }[];
  /** A model HQ doesn't list: its id and prices as typed. Empty for a listed one. */
  readonly other: { readonly id: string; readonly input: string; readonly output: string };
  readonly budget: string;
  readonly features: readonly { readonly key: Feature; readonly label: string; readonly what: string; readonly phase: string; readonly on: boolean }[];
  readonly priceGuide: string;
  readonly month: { readonly spent: string; readonly budget: string; readonly percent: number; readonly state: BudgetState; readonly calls: number; readonly failed: number };
  readonly recent: readonly { readonly when: string; readonly feature: string; readonly model: string; readonly cost: string; readonly outcome: string; readonly ok: boolean }[];
  readonly updated: string;
};

const perMillion = (micros: number): string => (micros / 1_000_000).toFixed(6).replace(/\.?0+$/, "");

export function monthUsage(deps: AiDeps): AiSettingsView["month"] {
  const settings = deps.ai.settings();
  const spent = deps.ai.spentSince(deps.monthStart());
  const counts = deps.ai.countSince(deps.monthStart());
  const budgetMicros = settings.budgetMinor * 10_000;
  return { spent: dollarsText(spent), budget: dollarsText(budgetMicros), percent: budgetMicros === 0 ? 100 : Math.min(100, Math.floor((spent * 100) / budgetMicros)), state: budgetState(spent, settings.budgetMinor), calls: counts.calls, failed: counts.failed };
}

const OUTCOME: Record<string, string> = { waiting: "Draft waiting", used: "Used", discarded: "Discarded" };

/** Settings → AI: the model, the budget, the features, the price guide, and this month's spending. `ai.manage`. */
export function aiSettingsView(deps: AiDeps, actorId: Id | null): Result<AiSettingsView, "forbidden"> {
  if (!may(deps, actorId, "ai.manage")) return err("forbidden");
  const settings = deps.ai.settings();
  const listed = knownModel(settings.model) !== null;
  return ok({
    keySet: deps.model !== null,
    model: listed ? settings.model : "other",
    models: [...KNOWN_MODELS.map((one) => ({ value: one.id, label: one.label })), { value: "other", label: "Another model" }],
    other: listed ? { id: "", input: "", output: "" } : { id: settings.model, input: perMillion(settings.price.input), output: perMillion(settings.price.output) },
    budget: (settings.budgetMinor / 100).toFixed(2).replace(/\.00$/, ""),
    features: FEATURES.map((key) => ({ key, ...FEATURE_TEXT[key], on: settings.features.includes(key) })),
    priceGuide: settings.priceGuide,
    month: monthUsage(deps),
    recent: deps.ai.recentUsage(25).map((row) => {
      const draft = row.draftId ? deps.ai.getDraft(row.draftId) : null;
      return { when: deps.formatWhen(row.at), feature: isFeature(row.feature) ? FEATURE_TEXT[row.feature].label : row.feature, model: row.model, cost: dollarsText(row.cost), outcome: row.ok ? (OUTCOME[draft?.status ?? "waiting"] ?? "") : row.problem || "No answer", ok: row.ok };
    }),
    updated: settings.updatedBy ? `Last changed by ${deps.users.get(settings.updatedBy)?.name ?? "someone"} on ${deps.formatWhen(settings.updatedAt)}` : "",
  });
}

/** Saves Settings → AI. `ai.manage`. A change applies from the next call. */
export function saveAiSettings(deps: AiDeps, actorId: Id | null, input: SettingsInput): Result<AiSettings, "forbidden" | SettingsError> {
  if (!may(deps, actorId, "ai.manage")) return err("forbidden");
  const read = readSettings(input);
  if (!read.ok) return read;
  return deps.transact(() => {
    const before = deps.ai.settings();
    deps.ai.saveSettings(read.value, actorId, deps.clock());
    recordActivity(deps, {
      actorId,
      action: "ai.settings-changed",
      recordType: "ai-setting",
      recordId: "ai-setting" as Id,
      context: { model: read.value.model, budgetMinor: read.value.budgetMinor, features: [...read.value.features], modelWas: before.model, budgetWas: before.budgetMinor, priceGuideChanged: before.priceGuide !== read.value.priceGuide },
    });
    return ok(read.value);
  });
}

// ---- The drafts list --------------------------------------------------------

export type DraftLine = { readonly id: string; readonly feature: string; readonly what: string; readonly href: string; readonly when: string; readonly by: string };

/** Where each kind of draft is used. */
const PLACE: { readonly [K in Feature]: (recordId: string) => string } = {
  "call-recap": (id) => `/phone/${id}/recap`,
  "call-brief": (id) => `/get-ready/${id}`,
  "lead-triage": (id) => `/opportunities/${id}#ai`,
  "check-in": (id) => `/opportunities/${id}#ai`,
  "proposal-draft": (id) => `/opportunities/${id}#ai`,
  "scope-check": (id) => `/projects/${id}#ai`,
  "weekly-update": (id) => `/projects/${id}#ai`,
  ask: () => "/ask",
  receipt: (id) => `/projects/${id}/money#ai`,
  "site-diagnosis": () => "/sites",
  "case-study": () => "/marketing",
  "social-posts": () => "/marketing",
};

export type DraftsView = { readonly items: readonly DraftLine[]; readonly month: AiSettingsView["month"] | null };

/**
 * Drafts waiting for a person, that this person may use: the Drafts page and
 * Today. Ask HQ's answers aren't listed: they're read where they were asked.
 */
export function waitingDrafts(deps: AiDeps, actorId: Id | null, describe: (draft: Draft) => string): DraftsView {
  if (actorId === null) return { items: [], month: null };
  const items = deps.ai
    .waiting(200)
    .filter((draft) => draft.feature !== "ask" && mayUse(deps, actorId, draft.feature))
    .map((draft) => ({ id: draft.id, feature: FEATURE_TEXT[draft.feature].label, what: describe(draft), href: PLACE[draft.feature](draft.recordId), when: deps.formatWhen(draft.createdAt), by: draft.createdBy ? (deps.users.get(draft.createdBy)?.name ?? "Someone") : "HQ" }));
  return { items, month: may(deps, actorId, "ai.manage") ? monthUsage(deps) : null };
}

/** For pages: whether a feature's button shows, and if not, why. */
export type FeatureState = { readonly on: boolean; readonly why: string };

export function featureState(deps: AiDeps, actorId: Id | null, feature: Feature): FeatureState {
  if (!mayUse(deps, actorId, feature) || actorId === null) return { on: false, why: "" };
  if (!deps.ai.settings().features.includes(feature)) return { on: false, why: "" };
  if (!deps.model) return { on: false, why: "AI needs HQ_ANTHROPIC_API_KEY set on the server." };
  const settings = deps.ai.settings();
  if (budgetState(deps.ai.spentSince(deps.monthStart()), settings.budgetMinor) === "reached") return { on: false, why: "Budget reached: AI is paused until the first of the month, or until the budget is raised in Settings → AI." };
  return { on: true, why: "" };
}

/**
 * An activity log that marks a draft used when what it was for is done by
 * hand: a recap sent from the form its draft filled. Wire it where calls are
 * recorded.
 */
export function withDraftOutcomes(log: ActivityLog, ai: Pick<AiStore, "waitingFor" | "decide">): ActivityLog {
  return {
    append(event) {
      log.append(event);
      if (event.action === "call.recap-sent") for (const draft of ai.waitingFor("call-recap", event.recordId)) ai.decide(draft.id, "used", event.actorId, event.occurredAt);
    },
  };
}
