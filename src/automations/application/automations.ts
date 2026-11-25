// n8n automations run for clients (decision 0010, section 5). Potomac's
// people add each one to its client (`automation.manage`) and get a secret
// address for n8n to post to at the end of a run. HQ keeps the runs, notices
// one that failed or didn't run on time, puts it on Today and emails the
// alert address once, and again when it's running fine. The client sees
// their automations, and whether each is running, in the portal.
import { afterRun, alertFor, automationFields, isLate, needsAttention, RUNS_KEPT, SCHEDULE_LABELS, SCHEDULES, STATE_LABELS, type Automation, type AutomationError, type AutomationInput, type AutomationState } from "../domain/automation.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { AutomationStore, SecretTokens } from "./ports.ts";

export type AutomationsDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly automations: AutomationStore;
  readonly tokens: SecretTokens;
  readonly formatWhen: (instant: string) => string;
  readonly clientName: (organizationId: Id) => string | null;
};

type Refused = "forbidden" | "not-found";
const may = (deps: AutomationsDeps, actorId: Id | null, permission: string): actorId is Id => actorId !== null && authorize(deps, actorId, permission).ok;
const hookPath = (token: string) => `/hooks/automations/${token}`;

/** Adds an automation to a client. The answer carries its secret address's token, shown once. */
export function addAutomation(deps: AutomationsDeps, actorId: Id | null, organizationId: Id, input: AutomationInput): Result<{ readonly automation: Automation; readonly token: string }, Refused | AutomationError> {
  if (!may(deps, actorId, "automation.manage")) return err("forbidden");
  const fields = automationFields(input);
  if (!fields.ok) return fields;
  return deps.transact(() => {
    if (deps.clientName(organizationId) === null) return err("not-found");
    const at = deps.clock();
    const token = deps.tokens.newToken();
    const automation: Automation = { id: deps.newId(), organizationId, ...fields.value, active: true, state: "waiting", lastRunAt: null, lastMessage: "", alerted: "waiting", createdAt: at };
    deps.automations.insert(automation, deps.tokens.hash(token), at);
    recordActivity(deps, { actorId, action: "automation.added", recordType: "automation", recordId: automation.id, context: { organizationId, name: automation.name } });
    return ok({ automation, token });
  });
}

export function editAutomation(deps: AutomationsDeps, actorId: Id | null, id: Id, input: AutomationInput & { readonly active: boolean }): Result<Automation, Refused | AutomationError> {
  if (!may(deps, actorId, "automation.manage")) return err("forbidden");
  const fields = automationFields(input);
  if (!fields.ok) return fields;
  return deps.transact(() => {
    const found = deps.automations.get(id);
    if (!found) return err("not-found");
    // Paused, it's never late; turned back on, it's waiting for its next run.
    const changed: Automation = { ...found, ...fields.value, active: input.active, ...(input.active && !found.active ? { state: "waiting" as const, alerted: "waiting" as const, lastRunAt: null, createdAt: deps.clock() } : {}) };
    deps.automations.save(changed, deps.clock());
    recordActivity(deps, { actorId, action: "automation.changed", recordType: "automation", recordId: id, context: { organizationId: found.organizationId, name: changed.name, active: changed.active } });
    return ok(changed);
  });
}

/** A new secret address. The old one stops working at once. */
export function newAutomationSecret(deps: AutomationsDeps, actorId: Id | null, id: Id): Result<{ readonly automation: Automation; readonly token: string }, Refused> {
  if (!may(deps, actorId, "automation.manage")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.automations.get(id);
    if (!found) return err("not-found");
    const token = deps.tokens.newToken();
    deps.automations.setToken(id, deps.tokens.hash(token), deps.clock());
    recordActivity(deps, { actorId, action: "automation.secret-replaced", recordType: "automation", recordId: id, context: { organizationId: found.organizationId, name: found.name } });
    return ok({ automation: found, token });
  });
}

export function removeAutomation(deps: AutomationsDeps, actorId: Id | null, id: Id): Result<Automation, Refused> {
  if (!may(deps, actorId, "automation.manage")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.automations.get(id);
    if (!found) return err("not-found");
    deps.automations.remove(id);
    recordActivity(deps, { actorId, action: "automation.removed", recordType: "automation", recordId: id, context: { organizationId: found.organizationId, name: found.name } });
    return ok(found);
  });
}

/**
 * n8n checked in. The token in the address is the only key. A run is a
 * fact, not a change someone made, so it writes no activity event: its own
 * row is the record, as with a referral link's scan.
 */
export function checkIn(deps: AutomationsDeps, token: string, status: string, message: string): Result<{ readonly state: AutomationState }, "not-found" | "invalid-status"> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return err("not-found");
  const outcome = status === "" || status === "ok" || status === "success" ? "ok" : status === "failed" || status === "error" ? "failed" : null;
  if (!outcome) return err("invalid-status");
  return deps.transact(() => {
    const found = deps.automations.byTokenHash(deps.tokens.hash(token));
    if (!found) return err("not-found");
    const at = deps.clock();
    const ran = afterRun(found, outcome, message, at);
    deps.automations.save(ran, at);
    deps.automations.addRun(found.id, { at, status: outcome, message: ran.lastMessage }, RUNS_KEPT);
    return ok({ state: ran.state });
  });
}

export type AutomationAlert = { readonly subject: string; readonly body: string };

/**
 * Marks automations that didn't run on time as late, and says what to tell
 * Potomac about: each turn for the worse once, and getting better once. Run
 * every few minutes. `alert` is null when nobody can be told; the states are
 * still kept, and Today still shows them.
 */
export async function checkAutomations(deps: AutomationsDeps, alert: ((message: AutomationAlert) => Promise<boolean>) | null, publicUrl: string): Promise<{ readonly late: number; readonly alerted: number }> {
  const now = deps.clock();
  let late = 0;
  let alerted = 0;
  for (const found of deps.automations.list()) {
    let current = found;
    if (current.active && current.state !== "late" && current.state !== "failed" && isLate(current, now)) {
      current = { ...current, state: "late" };
      deps.automations.save(current, now);
      late++;
    }
    const kind = alertFor(current);
    if (!kind) continue;
    if (alert) {
      const client = deps.clientName(current.organizationId) ?? "A client";
      const what = kind === "recovered" ? "is running again" : current.state === "failed" ? "failed" : "didn’t run on time";
      const lines = [`${current.name}, for ${client}, ${what}.`, ...(current.lastMessage ? ["", `Its last message: ${current.lastMessage}`] : []), "", `In HQ: ${publicUrl}/clients/${current.organizationId}#automations`, ...(current.n8nUrl ? [`In n8n: ${current.n8nUrl}`] : [])];
      const sent = await alert({ subject: `Automation ${what}: ${current.name} (${client})`, body: lines.join("\n") }).catch(() => false);
      if (!sent) continue;
      alerted++;
    }
    deps.transact(() => {
      const fresh = deps.automations.get(current.id);
      if (fresh) deps.automations.save({ ...fresh, alerted: current.state }, deps.clock());
    });
  }
  return { late, alerted };
}

export type AutomationLine = {
  readonly id: string;
  readonly organizationId: string;
  readonly clientName: string;
  readonly name: string;
  readonly description: string;
  readonly n8nUrl: string;
  readonly every: string;
  readonly everyMinutes: number;
  readonly active: boolean;
  readonly state: AutomationState;
  readonly stateLabel: string;
  readonly attention: boolean;
  readonly lastRun: string;
  readonly lastMessage: string;
  readonly runs: readonly { readonly when: string; readonly ok: boolean; readonly message: string }[];
};

function lineOf(deps: AutomationsDeps, one: Automation, withRuns: boolean): AutomationLine {
  return {
    id: one.id,
    organizationId: one.organizationId,
    clientName: deps.clientName(one.organizationId) ?? "",
    name: one.name,
    description: one.description,
    n8nUrl: one.n8nUrl,
    every: SCHEDULE_LABELS[one.everyMinutes] ?? `Every ${one.everyMinutes} minutes`,
    everyMinutes: one.everyMinutes,
    active: one.active,
    state: one.state,
    stateLabel: one.active ? STATE_LABELS[one.state] : "Paused",
    attention: one.active && needsAttention(one.state),
    lastRun: one.lastRunAt ? deps.formatWhen(one.lastRunAt) : "",
    lastMessage: one.lastMessage,
    runs: withRuns ? deps.automations.runs(one.id, 10).map((run) => ({ when: deps.formatWhen(run.at), ok: run.status === "ok", message: run.message })) : [],
  };
}

export type ClientAutomationsView = { readonly organizationId: string; readonly canManage: boolean; readonly items: readonly AutomationLine[]; readonly schedules: readonly { readonly value: string; readonly label: string }[] };

/** A client's automations, for their page in HQ; null for someone who may not see clients. */
export function clientAutomations(deps: AutomationsDeps, actorId: Id | null, organizationId: Id): ClientAutomationsView | null {
  if (!may(deps, actorId, "client.view") || deps.clientName(organizationId) === null) return null;
  return { organizationId, canManage: may(deps, actorId, "automation.manage"), items: deps.automations.listFor(organizationId).map((one) => lineOf(deps, one, true)), schedules: SCHEDULES.map((value) => ({ value: String(value), label: SCHEDULE_LABELS[value] ?? "" })) };
}

/** Every automation, those needing attention first. */
export function allAutomations(deps: AutomationsDeps, actorId: Id | null): Result<readonly AutomationLine[], "forbidden"> {
  if (!may(deps, actorId, "client.view")) return err("forbidden");
  return ok(deps.automations.list().map((one) => lineOf(deps, one, false)).sort((a, b) => Number(b.attention) - Number(a.attention)));
}

/** Failed or late, for Today. */
export function automationsNeedingAttention(deps: AutomationsDeps, actorId: Id | null): readonly AutomationLine[] {
  if (!may(deps, actorId, "client.view")) return [];
  return deps.automations.list().filter((one) => one.active && needsAttention(one.state)).map((one) => lineOf(deps, one, false));
}

/** The signed-in client's automations, without n8n's address or anything secret. */
export function portalAutomations(deps: AutomationsDeps, organizationId: Id | null): readonly { readonly name: string; readonly description: string; readonly every: string; readonly status: string; readonly lastRun: string; readonly attention: boolean }[] {
  if (!organizationId) return [];
  return deps.automations
    .listFor(organizationId)
    .filter((one) => one.active)
    .map((one) => ({ name: one.name, description: one.description, every: SCHEDULE_LABELS[one.everyMinutes] ?? "", status: one.state === "ok" ? "Running fine" : one.state === "waiting" ? "Starting soon" : "We’re looking into it", lastRun: one.lastRunAt ? deps.formatWhen(one.lastRunAt) : "", attention: needsAttention(one.state) }));
}

/** The address n8n posts to, for the page that shows it once. */
export const secretAddress = (publicUrl: string, token: string): string => `${publicUrl}${hookPath(token)}`;
