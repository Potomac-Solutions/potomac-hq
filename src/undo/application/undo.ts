// Undo on everyday buttons (quality of life, 2026-11-25). A route that moves
// a task or ticks a to-do records a step; the page it lands on offers Undo;
// Undo puts it back through the same module's own command, as the person.
import { undoable, type UndoKind, type UndoStep } from "../domain/undo.ts";
import type { IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";

export type UndoStore = {
  add(step: UndoStep): void;
  get(id: Id): UndoStep | null;
  used(id: Id, at: string): void;
};

/** What puts each kind back, as the person. */
export type UndoActions = {
  setTaskStatus(actorId: Id, taskId: Id, status: string): Result<unknown, string>;
  setTodoDone(actorId: Id, todoId: Id, done: boolean): Result<unknown, string>;
};

export type UndoDeps = ActivityDeps & { readonly users: IdentityUserStore; readonly transact: Transact; readonly steps: UndoStore; readonly actions: UndoActions };

/** Records a step that can be undone, and answers its id for the page's address. */
export function rememberUndo(deps: UndoDeps, actorId: Id, step: { readonly kind: UndoKind; readonly recordId: string; readonly was: string; readonly label: string }): Id {
  const id = deps.newId();
  deps.steps.add({ ...step, id, userId: actorId, label: step.label.slice(0, 200), createdAt: deps.clock(), usedAt: null });
  return id;
}

/** What the page offers: the label, if it can still be undone by this person. */
export function undoOffer(deps: UndoDeps, actorId: Id | null, id: string): { readonly id: string; readonly label: string } | null {
  if (actorId === null || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const step = deps.steps.get(id as Id);
  return undoable(step, actorId, deps.clock()) ? { id: step.id, label: step.label } : null;
}

export function runUndo(deps: UndoDeps, actorId: Id | null, id: Id): Result<UndoStep, "forbidden" | "not-found" | "too-late" | string> {
  if (actorId === null || deps.users.get(actorId)?.status !== "active") return err("forbidden");
  const step = deps.steps.get(id);
  if (!step || step.userId !== actorId) return err("not-found");
  if (!undoable(step, actorId, deps.clock())) return err("too-late");
  const done =
    step.kind === "task-status" ? deps.actions.setTaskStatus(actorId, step.recordId as Id, step.was) : deps.actions.setTodoDone(actorId, step.recordId as Id, step.kind === "todo-reopen");
  if (!done.ok && done.error !== "unchanged") return err(done.error);
  deps.transact(() => {
    deps.steps.used(id, deps.clock());
    recordActivity(deps, { actorId, action: "undo.used", recordType: step.kind.startsWith("todo") ? "todo" : "task", recordId: step.recordId as Id, context: { kind: step.kind } });
  });
  return ok(step);
}
