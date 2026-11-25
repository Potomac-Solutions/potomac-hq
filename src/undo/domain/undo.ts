// Undo on everyday buttons (quality of life, 2026-11-25): what one change was,
// so it can be put back, by the person who made it, for ten minutes.

export const UNDO_KINDS = ["task-status", "todo-done", "todo-reopen"] as const;
export type UndoKind = (typeof UNDO_KINDS)[number];

export type UndoStep = {
  readonly id: string;
  readonly userId: string;
  readonly kind: UndoKind;
  readonly recordId: string;
  /** What it was before: a task's status, or empty. */
  readonly was: string;
  /** What was done, in words: "Moved “Menu page” to Done". */
  readonly label: string;
  readonly createdAt: string;
  readonly usedAt: string | null;
};

export const UNDO_MINUTES = 10;

/** Whether a step can still be undone, by this person, now. */
export function undoable(step: UndoStep | null, userId: string, now: string): step is UndoStep {
  return step !== null && step.userId === userId && step.usedAt === null && Date.parse(now) - Date.parse(step.createdAt) <= UNDO_MINUTES * 60_000;
}
