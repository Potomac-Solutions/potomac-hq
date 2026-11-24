// Subtasks and blocking (decision 0007, section 5): adding a subtask under a
// project task, and marking one task as waiting on another. The rules are in
// ../domain/dependencies.ts. Each change needs `task.edit` and records an event.
import { mayBlock, mayHaveSubtasks, type BlockError, type SubtaskError } from "../domain/dependencies.ts";
import { newTask, type Task, type TaskInput } from "../domain/task.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { ProjectsDeps, Refused, TaskChangeError } from "./commands.ts";

const allowed = (deps: ProjectsDeps, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "task.edit").ok;

/** Adds a subtask: a task in the parent's project and phase, under the parent. */
export function addSubtask(deps: ProjectsDeps, actorId: Id | null, parentId: Id, input: TaskInput): Result<Task, TaskChangeError | SubtaskError> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const parent = deps.tasks.get(parentId);
    if (!parent) return err("not-found");
    const may = mayHaveSubtasks({ projectId: parent.projectId, parentId: deps.taskLinks.parentOf(parentId) });
    if (!may.ok) return may;
    const projectId = may.value;
    if (deps.projects.get(projectId)?.status !== "active") return err("project-closed");
    if (input.assigneeId && deps.users.get(input.assigneeId)?.status !== "active") return err("person-not-found");
    const made = newTask(deps.newId(), projectId, { ...input, phaseId: parent.phaseId });
    if (!made.ok) return made;
    deps.tasks.insert(made.value, deps.clock(), { parentId, createdBy: actorId });
    recordActivity(deps, { actorId, action: "task.added", recordType: "task", recordId: made.value.id, context: { projectId, title: made.value.title, assigneeId: made.value.assigneeId, parentId, parent: parent.title } });
    return ok(made.value);
  });
}

/** Marks `blockedId` as waiting on `blockerId`. */
export function blockTask(deps: ProjectsDeps, actorId: Id | null, blockedId: Id, blockerId: Id): Result<Task, Refused | BlockError> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const blocked = deps.tasks.get(blockedId);
    const blocker = deps.tasks.get(blockerId);
    if (!blocked || !blocker) return err("not-found");
    const may = mayBlock(blockedId, blockerId, (id) => deps.taskLinks.blockersOf(id));
    if (!may.ok) return may;
    deps.taskLinks.block(blockedId, blockerId, actorId, deps.clock());
    recordActivity(deps, { actorId, action: "task.blocked", recordType: "task", recordId: blockedId, context: { projectId: blocked.projectId, title: blocked.title, blockerId, blocker: blocker.title } });
    return ok(blocked);
  });
}

/** It no longer waits on that task. */
export function unblockTask(deps: ProjectsDeps, actorId: Id | null, blockedId: Id, blockerId: Id): Result<Task, Refused> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const blocked = deps.tasks.get(blockedId);
    if (!blocked || !deps.taskLinks.unblock(blockedId, blockerId)) return err("not-found");
    recordActivity(deps, { actorId, action: "task.unblocked", recordType: "task", recordId: blockedId, context: { projectId: blocked.projectId, title: blocked.title, blockerId, blocker: deps.tasks.get(blockerId)?.title ?? "" } });
    return ok(blocked);
  });
}

/** The unfinished tasks this one waits on, by title. */
export const stillWaitingOn = (deps: ProjectsDeps, taskId: Id): string[] =>
  deps.taskLinks
    .waitingOn(taskId)
    .filter((row) => row.status !== "done")
    .map((row) => row.title);
