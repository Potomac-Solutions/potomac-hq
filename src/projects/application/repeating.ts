// Repeating tasks (decision 0007, section 7). Setting or stopping a repeat is
// a task edit. Finishing a repeating task makes the next one: same title,
// details, person, priority, estimate, phase, labels and subtasks (not done),
// due on the next date, and linked to the one before. The finished one keeps
// its time and comments, and finishing it again makes no second copy. The
// making is repeatAfterDone in commands.ts, beside the move that finishes it.
import { readRepeat, type Repeat, type RepeatError } from "../domain/repeat.ts";
import type { Task } from "../domain/task.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { ProjectsDeps, Refused } from "./commands.ts";

const sameRepeat = (a: Repeat | null, b: Repeat | null) => a?.every === b?.every && a?.unit === b?.unit && a?.from === b?.from;

/** Sets how a task repeats, or with null, stops it. Subtasks don't repeat on their own: they come with their parent. */
export function setTaskRepeat(
  deps: ProjectsDeps,
  actorId: Id | null,
  taskId: Id,
  input: { readonly every?: string | null; readonly unit?: string | null; readonly from?: string | null } | null,
): Result<Task, Refused | RepeatError | "subtask-cannot-repeat" | "unchanged"> {
  if (actorId === null || !authorize(deps, actorId, "task.edit").ok) return err("forbidden");
  return deps.transact(() => {
    const task = deps.tasks.get(taskId);
    if (!task) return err("not-found");
    if (deps.taskLinks.parentOf(taskId) !== null) return err("subtask-cannot-repeat");
    const read = input ? readRepeat(input) : ok(null);
    if (!read.ok) return read;
    if (sameRepeat(deps.repeats.get(taskId), read.value)) return err("unchanged");
    deps.repeats.set(taskId, read.value, deps.clock());
    recordActivity(deps, {
      actorId,
      action: read.value ? "task.repeat-set" : "task.repeat-stopped",
      recordType: "task",
      recordId: taskId,
      context: { projectId: task.projectId, title: task.title, ...(read.value ? { repeat: read.value } : {}) },
    });
    return ok(task);
  });
}
