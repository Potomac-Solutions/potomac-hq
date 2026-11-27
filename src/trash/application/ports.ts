import type { DeletePlan, TrashKind } from "../domain/trash.ts";

export type TrashPlanRow = DeletePlan;

/** One record in the Trash, for its page. */
export type TrashLine = {
  readonly id: string;
  readonly kind: TrashKind;
  readonly recordId: string;
  readonly label: string;
  readonly clientName: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly deletedAt: string;
  /** The name of who deleted it. */
  readonly deletedBy: string;
};

/**
 * Moves records with everything that belongs to them into the Trash, and
 * back. Each call runs inside the caller's transaction; a delete that would
 * leave anything pointing at a missing row fails when the transaction commits.
 */
export type TrashEngine = {
  /** What deleting this record would take, or null if there's no such record. */
  plan(kind: TrashKind, id: string): TrashPlanRow | null;
  moveToTrash(kind: TrashKind, id: string, trash: { readonly id: string; readonly by: string; readonly at: string }): { readonly label: string; readonly counts: Readonly<Record<string, number>> } | null;
  restore(trashId: string): "restored" | "conflict" | "not-found";
  /** Removes it from the Trash for good. False if it wasn't there. */
  purge(trashId: string): boolean;
  /** Newest first. */
  list(): TrashLine[];
};
