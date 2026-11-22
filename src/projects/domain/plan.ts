// A project's plan: phases in order, and milestones with due dates. The next
// milestone is always worked out from them, never stored (roadmap v0.3).
import { calendarDate, requiredText } from "../../shared/domain/fields.ts";
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type Phase = {
  readonly id: Id;
  readonly projectId: Id;
  readonly name: string;
  /** 0 for the first phase. */
  readonly position: number;
};

export type Milestone = {
  readonly id: Id;
  readonly projectId: Id;
  readonly phaseId: Id | null;
  readonly name: string;
  /** YYYY-MM-DD. */
  readonly dueOn: string | null;
  /** The day it was completed, or null while it is open. */
  readonly doneOn: string | null;
  /** True when it is the client's to do, like sending photos. The portal tells them so. */
  readonly forClient: boolean;
};

export type PlanError = "name-missing" | "name-too-long" | "invalid-date";

/** A new phase goes after the ones the project already has. */
export function newPhase(id: Id, projectId: Id, existing: number, input: { readonly name: string }): Result<Phase, PlanError> {
  const name = requiredText(input.name, 120);
  if (!name.ok) return err(name.error === "missing" ? "name-missing" : "name-too-long");
  return ok({ id, projectId, name: name.value, position: existing });
}

export function newMilestone(id: Id, projectId: Id, input: { readonly name: string; readonly dueOn?: string | null; readonly phaseId?: Id | null; readonly forClient?: boolean }): Result<Milestone, PlanError> {
  const name = requiredText(input.name, 200);
  if (!name.ok) return err(name.error === "missing" ? "name-missing" : "name-too-long");
  const due = (input.dueOn ?? "").trim();
  const dueOn = due === "" ? ok(null) : calendarDate(due);
  if (!dueOn.ok) return dueOn;
  return ok({ id, projectId, phaseId: input.phaseId ?? null, name: name.value, dueOn: dueOn.value, doneOn: null, forClient: input.forClient === true });
}

export function completeMilestone(milestone: Milestone, today: string): Result<Milestone, "already-done"> {
  return milestone.doneOn !== null ? err("already-done") : ok({ ...milestone, doneOn: today });
}

/** Says whose a milestone is to do: the client's, or Potomac's. */
export function assignMilestone(milestone: Milestone, forClient: boolean): Result<Milestone, "unchanged"> {
  return milestone.forClient === forClient ? err("unchanged") : ok({ ...milestone, forClient });
}

export function reopenMilestone(milestone: Milestone): Result<Milestone, "not-done"> {
  return milestone.doneOn === null ? err("not-done") : ok({ ...milestone, doneOn: null });
}

/**
 * The open milestone due soonest. One with no date comes after every dated
 * one. Null when every milestone is done, or there are none.
 */
export function nextMilestone(milestones: readonly Milestone[]): Milestone | null {
  const open = milestones.filter((milestone) => milestone.doneOn === null);
  open.sort((a, b) => {
    if (a.dueOn === b.dueOn) return a.name.localeCompare(b.name);
    if (a.dueOn === null) return 1;
    if (b.dueOn === null) return -1;
    return a.dueOn < b.dueOn ? -1 : 1;
  });
  return open[0] ?? null;
}

export function milestoneProgress(milestones: readonly Milestone[]): { readonly done: number; readonly total: number } {
  return { done: milestones.filter((milestone) => milestone.doneOn !== null).length, total: milestones.length };
}

export const isMilestoneOverdue = (milestone: Milestone, today: string): boolean => milestone.doneOn === null && milestone.dueOn !== null && milestone.dueOn < today;
