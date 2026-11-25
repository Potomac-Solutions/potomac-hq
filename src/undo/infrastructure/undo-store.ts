// Undo steps (migration 0078).
import type { UndoStore } from "../application/undo.ts";
import type { UndoKind } from "../domain/undo.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

export function sqliteUndoStore(db: Database): UndoStore {
  const add = db.prepare("insert into undo_step (id, user_id, kind, record_id, was, label, created_at) values (?, ?, ?, ?, ?, ?, ?)");
  const get = db.prepare("select * from undo_step where id = ?");
  const used = db.prepare("update undo_step set used_at = ? where id = ? and used_at is null");
  return {
    add: (s) => void add.run(s.id, s.userId, s.kind, s.recordId, s.was, s.label, s.createdAt),
    get(id) {
      const row = get.get(id);
      return row ? { id: row["id"] as Id, userId: String(row["user_id"]), kind: row["kind"] as UndoKind, recordId: String(row["record_id"]), was: String(row["was"]), label: String(row["label"]), createdAt: String(row["created_at"]), usedAt: (row["used_at"] as string | null) ?? null } : null;
    },
    used: (id, at) => void used.run(at, id),
  };
}
