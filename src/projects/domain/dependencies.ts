// Subtasks and blocking (decision 0007, section 5).
//
// A subtask is a task with a parent: one level deep, in the parent's project.
// To-dos have no project, so this slice gives subtasks to project tasks only.
// Finishing a parent doesn't finish its subtasks.
//
// A task may be blocked by another, in any project or none. It can't block
// itself, or anything that already waits on it through others: no circles.
// Being blocked never stops a move; moving to "working on" only warns.
import { err, ok, type Result } from "../../shared/domain/result.ts";
import type { Id } from "../../shared/domain/id.ts";

export type SubtaskError = "parent-is-a-todo" | "parent-is-a-subtask";

/** Whether a task may have subtasks: a project task that isn't one itself. */
export function mayHaveSubtasks(parent: { readonly projectId: Id | null; readonly parentId: Id | null }): Result<Id, SubtaskError> {
  if (parent.projectId === null) return err("parent-is-a-todo");
  if (parent.parentId !== null) return err("parent-is-a-subtask");
  return ok(parent.projectId);
}

export type BlockError = "blocks-itself" | "makes-a-circle" | "already-blocked";

/**
 * Whether `blocker` may block `blocked`, given who already blocks whom.
 * `blockersOf(id)` lists the tasks that id waits on.
 */
export function mayBlock(blockedId: Id, blockerId: Id, blockersOf: (id: Id) => readonly Id[]): Result<true, BlockError> {
  if (blockedId === blockerId) return err("blocks-itself");
  if (blockersOf(blockedId).includes(blockerId)) return err("already-blocked");
  // A circle would close if the blocker already waits, directly or not, on the blocked task.
  const seen = new Set<Id>();
  const waiting: Id[] = [blockerId];
  while (waiting.length > 0) {
    const id = waiting.pop() as Id;
    if (id === blockedId) return err("makes-a-circle");
    if (seen.has(id)) continue;
    seen.add(id);
    waiting.push(...blockersOf(id));
  }
  return ok(true);
}

export type Progress = { readonly done: number; readonly total: number };

/** "3 of 5 done", or empty with no subtasks. */
export function progressText(progress: Progress | undefined): string {
  return progress && progress.total > 0 ? `${progress.done} of ${progress.total} done` : "";
}
