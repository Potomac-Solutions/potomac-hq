// Deleting clients, contacts, deals, proposals and projects into the Trash,
// putting them back, and purging them (decision 0023). Admins only
// (`record.delete`). Each record goes in its own transaction, so one that
// can't go doesn't hold up the rest of a bulk delete.
export { isTrashKind } from "../domain/trash.ts";
import { countOf, daysLeft, isTrashKind, describeCounts, KIND_LABELS, mayDelete, MAX_AT_ONCE, moneyReason, purgeDue, rowsIn, type TrashKind } from "../domain/trash.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { TrashEngine } from "./ports.ts";

export type TrashDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly trash: TrashEngine;
  /** Every client marked a demo, for "Delete all demo clients". */
  readonly demoClientIds: () => readonly string[];
  readonly formatWhen: (instant: string) => string;
};

type Refused = "forbidden" | "not-found";
const may = (deps: TrashDeps, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "record.delete").ok;
export const mayDeleteRecords = (deps: TrashDeps, actorId: Id | null): boolean => may(deps, actorId);

// What each kind is called in the activity log.
const RECORD_TYPE: Readonly<Record<TrashKind, string>> = { client: "client-organization", contact: "contact", opportunity: "opportunity", proposal: "proposal", project: "project" };
const ROOT: Readonly<Record<TrashKind, string>> = { client: "client_organization", contact: "contact", opportunity: "opportunity", proposal: "proposal", project: "project" };

const cleanIds = (ids: readonly string[]): string[] => [...new Set(ids.map((id) => id.trim()).filter((id) => /^[0-9a-f-]{36}$/.test(id)))];

export type DeletePreview = {
  readonly kind: TrashKind;
  readonly kindLabel: string;
  readonly items: readonly { readonly id: string; readonly label: string; readonly clientName: string; readonly takes: string; readonly refused: string }[];
  /** The ones that may go, comma-separated, for the form. */
  readonly ids: string;
  readonly count: number;
  readonly refusedCount: number;
};

/** What deleting these would take, and which would be refused, for the page that asks first. */
export function previewDelete(deps: TrashDeps, actorId: Id | null, kind: TrashKind, rawIds: readonly string[] | "demo-clients"): Result<DeletePreview, Refused | "too-many" | "nothing"> {
  if (!may(deps, actorId)) return err("forbidden");
  const ids = rawIds === "demo-clients" ? [...deps.demoClientIds()] : cleanIds(rawIds);
  if (ids.length === 0) return err("nothing");
  if (ids.length > MAX_AT_ONCE) return err("too-many");
  const items = ids.flatMap((id) => {
    const plan = deps.trash.plan(kind, id);
    if (!plan) return [];
    const allowed = mayDelete(plan);
    return [{ id, label: plan.label, clientName: plan.clientName, takes: describeCounts(plan.counts, ROOT[kind]), refused: allowed.ok ? "" : moneyReason(plan) }];
  });
  if (items.length === 0) return err("not-found");
  const going = items.filter((item) => !item.refused);
  return ok({ kind, kindLabel: KIND_LABELS[kind].one, items, ids: going.map((item) => item.id).join(","), count: going.length, refusedCount: items.length - going.length });
}

export type DeleteResult = { readonly trashIds: readonly string[]; readonly deleted: number; readonly refused: number; readonly message: string };

/** Moves each record, with what belongs to it, into the Trash. */
export function deleteRecords(deps: TrashDeps, actorId: Id | null, kind: string, rawIds: readonly string[]): Result<DeleteResult, Refused | "too-many" | "nothing" | "has-money" | "cant-delete" | "bad-kind"> {
  if (!may(deps, actorId)) return err("forbidden");
  if (!isTrashKind(kind)) return err("bad-kind");
  const ids = cleanIds(rawIds);
  if (ids.length === 0) return err("nothing");
  if (ids.length > MAX_AT_ONCE) return err("too-many");
  const trashIds: string[] = [];
  let refused = 0;
  let failed = 0;
  let missing = 0;
  for (const id of ids) {
    try {
      const done = deps.transact(() => {
        // Asked again inside the transaction: what's there now is what's decided on.
        const plan = deps.trash.plan(kind, id);
        if (!plan) return "missing" as const;
        if (!mayDelete(plan).ok) return "money" as const;
        const trashId = deps.newId();
        const moved = deps.trash.moveToTrash(kind, id, { id: trashId, by: actorId, at: deps.clock() });
        if (!moved) return "missing" as const;
        const rows = rowsIn(moved.counts);
        recordActivity(deps, { actorId, action: `${RECORD_TYPE[kind]}.trashed`, recordType: RECORD_TYPE[kind], recordId: id as Id, context: { trashId, label: moved.label, rows } });
        return trashId;
      });
      if (done === "missing") missing++;
      else if (done === "money") refused++;
      else trashIds.push(done);
    } catch {
      // Something outside it still points at a row it would take: nothing of this one was deleted.
      failed++;
    }
  }
  if (trashIds.length === 0) return err(refused > 0 ? "has-money" : failed > 0 ? "cant-delete" : "not-found");
  const parts = [`${countOf(kind, trashIds.length)} moved to the Trash.`];
  if (refused > 0) parts.push(`${countOf(kind, refused)} kept: real money records stay.`);
  if (failed > 0) parts.push(`${countOf(kind, failed)} couldn’t be deleted.`);
  if (missing > 0 && trashIds.length > 0) parts.push(`${countOf(kind, missing)} already gone.`);
  return ok({ trashIds, deleted: trashIds.length, refused, message: parts.join(" ") });
}

/** Puts records back from the Trash, as they were. */
export function restoreFromTrash(deps: TrashDeps, actorId: Id | null, rawIds: readonly string[]): Result<{ readonly restored: number; readonly message: string }, Refused | "nothing" | "conflict"> {
  if (!may(deps, actorId)) return err("forbidden");
  const ids = cleanIds(rawIds);
  if (ids.length === 0) return err("nothing");
  const lines = new Map(deps.trash.list().map((line) => [line.id, line]));
  let restored = 0;
  let conflicts = 0;
  for (const id of ids) {
    const line = lines.get(id);
    if (!line) continue;
    try {
      const done = deps.transact(() => {
        const answer = deps.trash.restore(id);
        if (answer === "restored") recordActivity(deps, { actorId, action: `${RECORD_TYPE[line.kind]}.restored`, recordType: RECORD_TYPE[line.kind], recordId: line.recordId as Id, context: { trashId: id, label: line.label } });
        return answer;
      });
      if (done === "restored") restored++;
      else if (done === "conflict") conflicts++;
    } catch {
      conflicts++;
    }
  }
  if (restored === 0) return err(conflicts > 0 ? "conflict" : "not-found");
  const message = restored === 1 && ids.length === 1 ? `${lines.get(ids[0] as string)?.label ?? "It"} is back.` : `${restored} put back.${conflicts > 0 ? ` ${conflicts} couldn’t be: something now takes their place.` : ""}`;
  return ok({ restored, message });
}

/** Removes records from the Trash for good. */
export function purgeFromTrash(deps: TrashDeps, actorId: Id | null, rawIds: readonly string[] | "all"): Result<{ readonly purged: number }, Refused | "nothing"> {
  if (!may(deps, actorId)) return err("forbidden");
  const lines = deps.trash.list();
  const wanted = rawIds === "all" ? lines : lines.filter((line) => cleanIds(rawIds).includes(line.id));
  if (wanted.length === 0) return err("nothing");
  return deps.transact(() => {
    let purged = 0;
    for (const line of wanted) {
      if (!deps.trash.purge(line.id)) continue;
      purged++;
      recordActivity(deps, { actorId, action: `${RECORD_TYPE[line.kind]}.purged`, recordType: RECORD_TYPE[line.kind], recordId: line.recordId as Id, context: { trashId: line.id, label: line.label } });
    }
    return ok({ purged });
  });
}

/** Purges what has been in the Trash for 30 days. Run each night, by HQ itself. */
export function purgeExpiredTrash(deps: TrashDeps): number {
  const now = deps.clock();
  const due = deps.trash.list().filter((line) => purgeDue(line.deletedAt, now));
  if (due.length === 0) return 0;
  return deps.transact(() => {
    let purged = 0;
    for (const line of due) {
      if (!deps.trash.purge(line.id)) continue;
      purged++;
      recordActivity(deps, { actorId: null, action: `${RECORD_TYPE[line.kind]}.purged`, recordType: RECORD_TYPE[line.kind], recordId: line.recordId as Id, context: { trashId: line.id, label: line.label, after: "30 days" } });
    }
    return purged;
  });
}

export type TrashView = {
  readonly items: readonly { readonly id: string; readonly kindLabel: string; readonly label: string; readonly clientName: string; readonly takes: string; readonly when: string; readonly by: string; readonly daysLeft: number }[];
};

/** The Trash page. */
export function trashView(deps: TrashDeps, actorId: Id | null): Result<TrashView, Refused> {
  if (!may(deps, actorId)) return err("forbidden");
  const now = deps.clock();
  return ok({
    items: deps.trash.list().map((line) => ({
      id: line.id,
      kindLabel: KIND_LABELS[line.kind].one.replace(/^./, (c) => c.toUpperCase()),
      label: line.label,
      clientName: line.clientName,
      takes: describeCounts(line.counts, ROOT[line.kind]),
      when: deps.formatWhen(line.deletedAt),
      by: line.deletedBy,
      daysLeft: daysLeft(line.deletedAt, now),
    })),
  });
}
