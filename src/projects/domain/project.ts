// Work Potomac has agreed to do: who owns it, how it is going, and when it
// starts and should be done (docs/data-model.md, "Project").
import { calendarDate, optionalText, requiredText } from "../../shared/domain/fields.ts";
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const PROJECT_KINDS = ["fixed", "ongoing"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const PROJECT_STATUSES = ["active", "completed", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_HEALTHS = ["on-track", "at-risk", "off-track"] as const;
export type ProjectHealth = (typeof PROJECT_HEALTHS)[number];

export type Project = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly opportunityId: Id;
  readonly ownerId: Id;
  readonly name: string;
  readonly kind: ProjectKind;
  readonly status: ProjectStatus;
  readonly description: string;
  readonly health: ProjectHealth;
  /** YYYY-MM-DD. */
  readonly startOn: string | null;
  readonly targetOn: string | null;
};

/** What a project needs from the opportunity it comes from. */
export type WonOpportunity = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly ownerId: Id;
  readonly title: string;
  readonly stage: string;
  readonly pricing: string | null;
};

/**
 * A project is made only from a won opportunity. Monthly and yearly plans
 * have no end, so they are `ongoing`; everything else is `fixed`.
 */
export function projectFromWon(id: Id, opportunity: WonOpportunity): Result<Project, "not-won"> {
  if (opportunity.stage !== "won") return err("not-won");
  const ongoing = opportunity.pricing === "monthly" || opportunity.pricing === "yearly";
  return ok({
    id,
    organizationId: opportunity.organizationId,
    opportunityId: opportunity.id,
    ownerId: opportunity.ownerId,
    name: opportunity.title,
    kind: ongoing ? "ongoing" : "fixed",
    status: "active",
    description: "",
    health: "on-track",
    startOn: null,
    targetOn: null,
  });
}

/**
 * A fixed project ends completed or cancelled. An ongoing one is never
 * completed: it stays active until it is cancelled. Both endings are final.
 */
export function changeProjectStatus(project: Project, to: string): Result<Project, "invalid-status" | "unchanged" | "final" | "ongoing-never-completes"> {
  if (!(PROJECT_STATUSES as readonly string[]).includes(to)) return err("invalid-status");
  if (to === project.status) return err("unchanged");
  if (project.status !== "active") return err("final");
  if (to === "completed" && project.kind === "ongoing") return err("ongoing-never-completes");
  if (to === "active") return err("final");
  return ok({ ...project, status: to as ProjectStatus });
}

export type ProjectEdit = {
  readonly name: string;
  readonly description?: string | null;
  readonly health: string;
  readonly startOn?: string | null;
  readonly targetOn?: string | null;
};

export type ProjectEditError = "name-missing" | "name-too-long" | "description-too-long" | "invalid-health" | "invalid-date" | "target-before-start";

const optionalDate = (value: string | null | undefined): Result<string | null, "invalid-date"> => {
  const text = (value ?? "").trim();
  return text === "" ? ok(null) : calendarDate(text);
};

/** The details a person edits by hand. Status and owner change through their own rules. */
export function editProject(project: Project, edit: ProjectEdit): Result<Project, ProjectEditError> {
  const name = requiredText(edit.name, 200);
  if (!name.ok) return err(name.error === "missing" ? "name-missing" : "name-too-long");
  const description = optionalText(edit.description, 5000);
  if (!description.ok) return err("description-too-long");
  if (!(PROJECT_HEALTHS as readonly string[]).includes(edit.health)) return err("invalid-health");
  const startOn = optionalDate(edit.startOn);
  if (!startOn.ok) return startOn;
  const targetOn = optionalDate(edit.targetOn);
  if (!targetOn.ok) return targetOn;
  if (startOn.value && targetOn.value && targetOn.value < startOn.value) return err("target-before-start");
  return ok({ ...project, name: name.value, description: description.value ?? "", health: edit.health as ProjectHealth, startOn: startOn.value, targetOn: targetOn.value });
}

export function changeProjectOwner(project: Project, ownerId: Id): Result<Project, "unchanged"> {
  return ownerId === project.ownerId ? err("unchanged") : ok({ ...project, ownerId });
}
