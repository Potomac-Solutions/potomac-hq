// n8n automations run for clients (decision 0013, section 5): what each one
// does, how often it should run, and whether it's running. Each checks in at
// the end of a run; one that failed, or hasn't checked in within its schedule
// and half again, needs attention.
import type { Id } from "../../shared/domain/id.ts";
import { optionalText, requiredText } from "../../shared/domain/fields.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

/** How often an automation should run, in minutes. */
export const SCHEDULES = [5, 15, 30, 60, 180, 360, 720, 1440, 10080] as const;
export const SCHEDULE_LABELS: Readonly<Record<number, string>> = { 5: "Every 5 minutes", 15: "Every 15 minutes", 30: "Every 30 minutes", 60: "Every hour", 180: "Every 3 hours", 360: "Every 6 hours", 720: "Twice a day", 1440: "Every day", 10080: "Every week" };

export type AutomationState = "waiting" | "ok" | "failed" | "late";
export const STATE_LABELS: Readonly<Record<AutomationState, string>> = { waiting: "Hasn’t run yet", ok: "Running fine", failed: "Failed", late: "Didn’t run on time" };

export type Automation = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly name: string;
  readonly description: string;
  /** Where it lives in n8n. Never shown to the client. */
  readonly n8nUrl: string;
  readonly everyMinutes: number;
  readonly active: boolean;
  readonly state: AutomationState;
  readonly lastRunAt: string | null;
  readonly lastMessage: string;
  /** The state Potomac was last told about, so each change is alerted once. */
  readonly alerted: AutomationState;
  readonly createdAt: string;
};

export type AutomationError = "name-missing" | "name-too-long" | "description-too-long" | "url-invalid" | "invalid-schedule";
export type AutomationInput = { readonly name: string; readonly description?: string | null; readonly n8nUrl?: string | null; readonly every: string };

export function automationFields(input: AutomationInput): Result<{ readonly name: string; readonly description: string; readonly n8nUrl: string; readonly everyMinutes: number }, AutomationError> {
  const name = requiredText(input.name.replace(/\s+/g, " "), 80);
  if (!name.ok) return err(name.error === "missing" ? "name-missing" : "name-too-long");
  const description = optionalText(input.description, 500);
  if (!description.ok) return err("description-too-long");
  const url = (input.n8nUrl ?? "").trim();
  if (url && !/^https:\/\/[^\s/@]+\.[^\s/@]+(\/[^\s]*)?$/.test(url)) return err("url-invalid");
  if (url.length > 300) return err("url-invalid");
  const every = Number(input.every);
  if (!(SCHEDULES as readonly number[]).includes(every)) return err("invalid-schedule");
  return ok({ name: name.value, description: description.value ?? "", n8nUrl: url, everyMinutes: every });
}

/** A run's own words, made safe to keep and show. */
export const cleanMessage = (typed: string): string => typed.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);

/** What a check-in makes of it. */
export function afterRun(automation: Automation, status: "ok" | "failed", message: string, at: string): Automation {
  return { ...automation, state: status, lastRunAt: at, lastMessage: cleanMessage(message) };
}

/** Late: nothing within its schedule and half again, counted from its last run, or from when it was added. */
export function isLate(automation: Pick<Automation, "active" | "everyMinutes" | "lastRunAt" | "createdAt">, now: string): boolean {
  if (!automation.active) return false;
  const since = automation.lastRunAt ?? automation.createdAt;
  const due = Temporal.Instant.from(since).add({ minutes: Math.ceil(automation.everyMinutes * 1.5) });
  return Temporal.Instant.compare(due, Temporal.Instant.from(now)) < 0;
}

/** Whether to tell Potomac: a turn for the worse, or back to running fine after one. */
export function alertFor(automation: Pick<Automation, "state" | "alerted">): "bad" | "recovered" | null {
  if (automation.state === automation.alerted) return null;
  if (automation.state === "failed" || automation.state === "late") return "bad";
  if (automation.state === "ok" && (automation.alerted === "failed" || automation.alerted === "late")) return "recovered";
  return null;
}

export const needsAttention = (state: AutomationState): boolean => state === "failed" || state === "late";

/** How many runs are kept for each. */
export const RUNS_KEPT = 50;
