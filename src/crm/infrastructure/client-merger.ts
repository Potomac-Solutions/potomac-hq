// Merging two clients (quality of life, 2026-11-25): every column in the
// database that points at a client, moved from one to the other. Found from
// the schema's own foreign keys, so a table added later moves too. A row that
// can't move (say, a second free landing page where one is allowed) throws,
// and the caller's transaction undoes the lot.
import type { ClientMerger } from "../application/commands.ts";
import type { Database } from "../../shared/adapters.ts";

export function sqliteClientMerger(db: Database): ClientMerger {
  const pointers = db
    .prepare("select m.name as tbl, p.\"from\" as col from sqlite_master m join pragma_foreign_key_list(m.name) p where m.type = 'table' and p.\"table\" = 'client_organization'")
    .all()
    .map((row) => ({ table: String(row["tbl"]), column: String(row["col"]) }))
    // Names come from the schema itself, never from a person; checked anyway.
    .filter((one) => /^[a-z_]+$/.test(one.table) && /^[a-z_]+$/.test(one.column));
  const updates = pointers.map((one) => db.prepare(`update ${one.table} set ${one.column} = ? where ${one.column} = ?`));
  // Notes point at what they're on by kind and id, with no foreign key, so the schema can't find them.
  const notes = db.prepare("update note set record_id = ? where record_type = 'client-organization' and record_id = ?");
  return (fromId, intoId) => {
    for (const update of updates) update.run(intoId, fromId);
    notes.run(intoId, fromId);
  };
}
