// Public entry for the Trash (decision 0023): deleting clients, contacts,
// deals, proposals and projects with everything that belongs to them, putting
// them back within 30 days, and purging them.
export * from "./application/trash.ts";
export type { TrashEngine, TrashLine } from "./application/ports.ts";
export { TRASH_DAYS, TRASH_KINDS, type TrashKind } from "./domain/trash.ts";
