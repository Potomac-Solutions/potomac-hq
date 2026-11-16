// The projects module's changes. Each one checks permission first, makes its
// change and writes its activity event in one transaction, and answers with a
// code. Every event carries the project's id, so the project's history can
// find it.
import type { Baseline } from "../domain/baseline.ts";
import { isClientVisible, newDeliverable, shareDeliverable, unshareDeliverable, type Deliverable, type DeliverableError } from "../domain/deliverable.ts";
import { assignMilestone, completeMilestone, newMilestone, newPhase, reopenMilestone, type Milestone, type Phase, type PlanError } from "../domain/plan.ts";
import { changeProjectOwner, changeProjectStatus, editProject, type Project, type ProjectEdit, type ProjectEditError } from "../domain/project.ts";
import { editTask, moveTask, newTask, type Task, type TaskError, type TaskInput } from "../domain/task.ts";
import { saveFile, type FilesDeps, type UploadError } from "../../files/index.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { BaselineStore, DeliverableStore, MilestoneStore, PhaseStore, ProjectHistory, ProjectStore, TaskStore } from "./ports.ts";

export type ProjectsDeps = FilesDeps & {
  readonly projects: ProjectStore;
  readonly phases: PhaseStore;
  readonly milestones: MilestoneStore;
  readonly tasks: TaskStore;
  readonly deliverables: DeliverableStore;
  readonly baselines: BaselineStore;
  readonly history: ProjectHistory;
  /** Today in the business time zone, YYYY-MM-DD. */
  readonly today: () => string;
  /** Formats a UTC instant for people, in the business time zone. */
  readonly formatWhen: (instant: string) => string;
  /**
   * Told about a task's move, inside the move's transaction. The timer
   * listens here: marking a task "working on" starts it (docs/workflow.md, B6).
   */
  readonly onTaskMoved?: (actorId: Id, task: Task, from: string) => void;
};

export type Refused = "forbidden" | "not-found";

function allowed(deps: ProjectsDeps, actorId: Id | null, action: string): actorId is Id {
  return actorId !== null && authorize(deps, actorId, action).ok;
}

/**
 * Sets a project's baseline from an accepted proposal and records it. It has
 * no permission check and no transaction of its own: call it inside the
 * transaction of the use case that accepted the proposal, after that use case
 * has checked its permission.
 */
export function applyBaseline(deps: Pick<ProjectsDeps, "baselines" | "activityLog" | "clock" | "newId">, actorId: Id | null, baseline: Baseline): void {
  deps.baselines.set(baseline, deps.clock());
  recordActivity(deps, {
    actorId,
    action: "project.baseline-set",
    recordType: "project",
    recordId: baseline.projectId,
    context: { proposalId: baseline.proposalId, version: baseline.version, minor: baseline.amount.minor, currency: baseline.amount.currency, minutes: baseline.minutes },
  });
}

const activeUser = (deps: ProjectsDeps, id: Id): boolean => deps.users.get(id)?.status === "active";

export function editProjectDetails(deps: ProjectsDeps, actorId: Id | null, projectId: Id, edit: ProjectEdit): Result<Project, Refused | ProjectEditError> {
  if (!allowed(deps, actorId, "project.edit")) return err("forbidden");
  return deps.transact(() => {
    const project = deps.projects.get(projectId);
    if (!project) return err("not-found");
    const edited = editProject(project, edit);
    if (!edited.ok) return edited;
    deps.projects.update(edited.value, deps.clock());
    recordActivity(deps, {
      actorId,
      action: "project.edited",
      recordType: "project",
      recordId: projectId,
      context: { name: edited.value.name, health: edited.value.health, startOn: edited.value.startOn, targetOn: edited.value.targetOn },
    });
    return ok(edited.value);
  });
}

export function setProjectStatus(deps: ProjectsDeps, actorId: Id | null, projectId: Id, to: string): Result<Project, Refused | "invalid-status" | "unchanged" | "final" | "ongoing-never-completes"> {
  if (!allowed(deps, actorId, "project.set-status")) return err("forbidden");
  return deps.transact(() => {
    const project = deps.projects.get(projectId);
    if (!project) return err("not-found");
    const changed = changeProjectStatus(project, to);
    if (!changed.ok) return changed;
    deps.projects.update(changed.value, deps.clock());
    recordActivity(deps, { actorId, action: "project.status-changed", recordType: "project", recordId: projectId, context: { from: project.status, to: changed.value.status } });
    return ok(changed.value);
  });
}

export function setProjectOwner(deps: ProjectsDeps, actorId: Id | null, projectId: Id, ownerId: Id): Result<Project, Refused | "unchanged" | "person-not-found"> {
  if (!allowed(deps, actorId, "project.set-owner")) return err("forbidden");
  return deps.transact(() => {
    const project = deps.projects.get(projectId);
    if (!project) return err("not-found");
    if (!activeUser(deps, ownerId)) return err("person-not-found");
    const changed = changeProjectOwner(project, ownerId);
    if (!changed.ok) return changed;
    deps.projects.update(changed.value, deps.clock());
    recordActivity(deps, { actorId, action: "project.owner-changed", recordType: "project", recordId: projectId, context: { from: project.ownerId, to: ownerId } });
    return ok(changed.value);
  });
}

/** The project, if it exists and is still active. Closed projects take no new plan, tasks or deliverables. */
function openProject(deps: ProjectsDeps, projectId: Id): Result<Project, "not-found" | "project-closed"> {
  const project = deps.projects.get(projectId);
  if (!project) return err("not-found");
  return project.status === "active" ? ok(project) : err("project-closed");
}

export function addPhase(deps: ProjectsDeps, actorId: Id | null, projectId: Id, input: { readonly name: string }): Result<Phase, Refused | "project-closed" | PlanError> {
  if (!allowed(deps, actorId, "project.plan")) return err("forbidden");
  return deps.transact(() => {
    const project = openProject(deps, projectId);
    if (!project.ok) return project;
    const phase = newPhase(deps.newId(), projectId, deps.phases.listFor(projectId).length, input);
    if (!phase.ok) return phase;
    deps.phases.insert(phase.value, deps.clock());
    recordActivity(deps, { actorId, action: "phase.added", recordType: "phase", recordId: phase.value.id, context: { projectId, name: phase.value.name } });
    return ok(phase.value);
  });
}

/** A phase id from a form must name a phase of this project. */
function phaseOf(deps: ProjectsDeps, projectId: Id, phaseId: Id | null | undefined): Result<Id | null, "phase-not-in-project"> {
  if (!phaseId) return ok(null);
  return deps.phases.get(phaseId)?.projectId === projectId ? ok(phaseId) : err("phase-not-in-project");
}

export function addMilestone(
  deps: ProjectsDeps,
  actorId: Id | null,
  projectId: Id,
  input: { readonly name: string; readonly dueOn?: string | null; readonly phaseId?: Id | null; readonly forClient?: boolean },
): Result<Milestone, Refused | "project-closed" | "phase-not-in-project" | PlanError> {
  if (!allowed(deps, actorId, "project.plan")) return err("forbidden");
  return deps.transact(() => {
    const project = openProject(deps, projectId);
    if (!project.ok) return project;
    const phase = phaseOf(deps, projectId, input.phaseId);
    if (!phase.ok) return phase;
    const milestone = newMilestone(deps.newId(), projectId, { ...input, phaseId: phase.value });
    if (!milestone.ok) return milestone;
    deps.milestones.insert(milestone.value, deps.clock());
    recordActivity(deps, { actorId, action: "milestone.added", recordType: "milestone", recordId: milestone.value.id, context: { projectId, name: milestone.value.name, dueOn: milestone.value.dueOn, forClient: milestone.value.forClient } });
    return ok(milestone.value);
  });
}

export function setMilestoneDone(deps: ProjectsDeps, actorId: Id | null, milestoneId: Id, done: boolean): Result<Milestone, Refused | "already-done" | "not-done"> {
  if (!allowed(deps, actorId, "project.plan")) return err("forbidden");
  return deps.transact(() => {
    const milestone = deps.milestones.get(milestoneId);
    if (!milestone) return err("not-found");
    const changed = done ? completeMilestone(milestone, deps.today()) : reopenMilestone(milestone);
    if (!changed.ok) return changed;
    deps.milestones.update(changed.value, deps.clock());
    recordActivity(deps, {
      actorId,
      action: done ? "milestone.completed" : "milestone.reopened",
      recordType: "milestone",
      recordId: milestoneId,
      context: { projectId: milestone.projectId, name: milestone.name },
    });
    return ok(changed.value);
  });
}

/** Says a milestone is the client's to do, or takes that back. The portal lists the client's open ones as waiting on them. */
export function setMilestoneForClient(deps: ProjectsDeps, actorId: Id | null, milestoneId: Id, forClient: boolean): Result<Milestone, Refused | "unchanged"> {
  if (!allowed(deps, actorId, "project.plan")) return err("forbidden");
  return deps.transact(() => {
    const milestone = deps.milestones.get(milestoneId);
    if (!milestone) return err("not-found");
    const changed = assignMilestone(milestone, forClient);
    if (!changed.ok) return changed;
    deps.milestones.update(changed.value, deps.clock());
    recordActivity(deps, { actorId, action: forClient ? "milestone.given-to-client" : "milestone.taken-back", recordType: "milestone", recordId: milestoneId, context: { projectId: milestone.projectId, name: milestone.name } });
    return ok(changed.value);
  });
}

export type TaskChangeError = Refused | "project-closed" | "phase-not-in-project" | "person-not-found" | TaskError;

export function addTask(deps: ProjectsDeps, actorId: Id | null, projectId: Id, input: TaskInput): Result<Task, TaskChangeError> {
  if (!allowed(deps, actorId, "task.edit")) return err("forbidden");
  return deps.transact(() => {
    const project = openProject(deps, projectId);
    if (!project.ok) return project;
    const phase = phaseOf(deps, projectId, input.phaseId);
    if (!phase.ok) return phase;
    if (input.assigneeId && !activeUser(deps, input.assigneeId)) return err("person-not-found");
    const task = newTask(deps.newId(), projectId, { ...input, phaseId: phase.value });
    if (!task.ok) return task;
    deps.tasks.insert(task.value, deps.clock());
    recordActivity(deps, { actorId, action: "task.added", recordType: "task", recordId: task.value.id, context: { projectId, title: task.value.title, assigneeId: task.value.assigneeId } });
    return ok(task.value);
  });
}

export function updateTask(deps: ProjectsDeps, actorId: Id | null, taskId: Id, input: TaskInput): Result<Task, TaskChangeError> {
  if (!allowed(deps, actorId, "task.edit")) return err("forbidden");
  return deps.transact(() => {
    const task = deps.tasks.get(taskId);
    if (!task) return err("not-found");
    const phase = phaseOf(deps, task.projectId, input.phaseId);
    if (!phase.ok) return phase;
    if (input.assigneeId && input.assigneeId !== task.assigneeId && !activeUser(deps, input.assigneeId)) return err("person-not-found");
    const edited = editTask(task, { ...input, phaseId: phase.value });
    if (!edited.ok) return edited;
    deps.tasks.update(edited.value, deps.clock());
    recordActivity(deps, {
      actorId,
      action: "task.edited",
      recordType: "task",
      recordId: taskId,
      context: { projectId: task.projectId, title: edited.value.title, assigneeId: edited.value.assigneeId, priority: edited.value.priority, dueOn: edited.value.dueOn },
    });
    return ok(edited.value);
  });
}

export function moveTaskStatus(deps: ProjectsDeps, actorId: Id | null, taskId: Id, to: string): Result<Task, Refused | "invalid-status" | "unchanged"> {
  if (!allowed(deps, actorId, "task.edit")) return err("forbidden");
  return deps.transact(() => {
    const task = deps.tasks.get(taskId);
    if (!task) return err("not-found");
    const at = deps.clock();
    const moved = moveTask(task, to, at);
    if (!moved.ok) return moved;
    deps.tasks.update(moved.value, at);
    recordActivity(deps, { actorId, action: "task.moved", recordType: "task", recordId: taskId, context: { projectId: task.projectId, from: task.status, to: moved.value.status } });
    deps.onTaskMoved?.(actorId, moved.value, task.status);
    return ok(moved.value);
  });
}

/** Stores the file and the deliverable together. The file is not visible to the client until the deliverable is shared. */
export function addDeliverable(
  deps: ProjectsDeps,
  actorId: Id | null,
  projectId: Id,
  input: { readonly title: string; readonly description?: string | null; readonly file: { readonly name: string; readonly bytes: Uint8Array } | null },
): Result<Deliverable, Refused | "project-closed" | DeliverableError | UploadError> {
  if (!allowed(deps, actorId, "deliverable.edit")) return err("forbidden");
  return deps.transact(() => {
    const project = openProject(deps, projectId);
    if (!project.ok) return project;
    const id = deps.newId();
    // Check the words before storing the bytes, so a bad title stores nothing.
    const draft = newDeliverable({ id, projectId, fileId: id, createdBy: actorId }, input);
    if (!draft.ok) return draft;
    const file = saveFile(deps, actorId, input.file ? { ...input.file, ownerType: "deliverable", ownerId: id, organizationId: project.value.organizationId, projectId } : null);
    if (!file.ok) return file;
    const deliverable = { ...draft.value, fileId: file.value.id };
    deps.deliverables.insert(deliverable, deps.clock());
    recordActivity(deps, { actorId, action: "deliverable.added", recordType: "deliverable", recordId: id, context: { projectId, title: deliverable.title, fileId: file.value.id } });
    return ok(deliverable);
  });
}

export function setDeliverableShared(deps: ProjectsDeps, actorId: Id | null, deliverableId: Id, shared: boolean): Result<Deliverable, Refused | "already-shared" | "not-shared" | "already-approved"> {
  if (!allowed(deps, actorId, "deliverable.edit")) return err("forbidden");
  return deps.transact(() => {
    const deliverable = deps.deliverables.get(deliverableId);
    if (!deliverable) return err("not-found");
    const at = deps.clock();
    const changed = shared ? shareDeliverable(deliverable, at) : unshareDeliverable(deliverable);
    if (!changed.ok) return changed;
    deps.deliverables.update(changed.value, at);
    deps.files.setClientVisible(changed.value.fileId, isClientVisible(changed.value));
    recordActivity(deps, {
      actorId,
      action: shared ? "deliverable.shared" : "deliverable.unshared",
      recordType: "deliverable",
      recordId: deliverableId,
      context: { projectId: deliverable.projectId, title: deliverable.title },
    });
    return ok(changed.value);
  });
}
