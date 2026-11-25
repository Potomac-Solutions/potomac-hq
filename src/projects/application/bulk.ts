// Changing many tasks and to-dos at once (quality of life, 2026-11-25): tick
// several on All work and move, assign, date or label them together. Each is
// changed through the same command as the task's own page, with its own
// checks and event, so a task someone may not change is skipped and counted.
// One more event records the batch.
import { isTaskStatus } from "../domain/task.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import { moveTaskStatus, setTaskLabels, updateTask, type ProjectsDeps } from "./commands.ts";

export const MOST_AT_ONCE = 100;

export type BulkAction =
  | { readonly kind: "status"; readonly to: string }
  | { readonly kind: "assign"; readonly to: string }
  | { readonly kind: "due"; readonly on: string }
  | { readonly kind: "label"; readonly labelId: string };

export type BulkResult = { readonly changed: number; readonly skipped: number };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Reads the bulk form: the action picked and its value. */
export function readBulkAction(action: string, value: string): BulkAction | null {
  const v = value.trim();
  if (action === "status") return isTaskStatus(v) ? { kind: "status", to: v } : null;
  if (action === "assign") return v === "" || v === "me" || v === "nobody" || ID.test(v) ? { kind: "assign", to: v } : null;
  if (action === "due") return v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v) ? { kind: "due", on: v } : null;
  if (action === "label") return ID.test(v) ? { kind: "label", labelId: v } : null;
  return null;
}

export function bulkChangeTasks(deps: ProjectsDeps, actorId: Id | null, taskIds: readonly string[], action: BulkAction | null): Result<BulkResult, "forbidden" | "nothing-picked" | "too-many" | "invalid-action"> {
  if (actorId === null || !authorize(deps, actorId, "task.edit").ok) return err("forbidden");
  const ids = [...new Set(taskIds.filter((id) => ID.test(id)))] as Id[];
  if (ids.length === 0) return err("nothing-picked");
  if (ids.length > MOST_AT_ONCE) return err("too-many");
  if (!action) return err("invalid-action");
  let changed = 0;
  let skipped = 0;
  for (const id of ids) {
    const task = deps.tasks.get(id);
    if (!task) {
      skipped += 1;
      continue;
    }
    const keep = { title: task.title, description: task.description, assigneeId: task.assigneeId, phaseId: task.phaseId, priority: task.priority, dueOn: task.dueOn, startOn: task.startOn, estimate: task.estimateMinutes === null ? null : String(task.estimateMinutes / 60) };
    const done =
      action.kind === "status"
        ? moveTaskStatus(deps, actorId, id, action.to)
        : action.kind === "assign"
          ? updateTask(deps, actorId, id, { ...keep, assigneeId: (action.to === "me" ? actorId : action.to === "nobody" ? null : action.to || null) as Id | null })
          : action.kind === "due"
            ? updateTask(deps, actorId, id, { ...keep, dueOn: action.on || null, startOn: action.on && task.startOn && task.startOn > action.on ? null : task.startOn })
            : setTaskLabels(deps, actorId, id, { labelIds: [...new Set([...deps.labels.forTask(id).map((label) => label.id), action.labelId as Id])] });
    if (done.ok || done.error === "unchanged") changed += 1;
    else skipped += 1;
  }
  deps.transact(() => recordActivity(deps, { actorId, action: "task.bulk-changed", recordType: "user", recordId: actorId, context: { kind: action.kind, changed, skipped } }));
  return ok({ changed, skipped });
}
