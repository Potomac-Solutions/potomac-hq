import type { NoteStore } from "../application/notes.ts";
import type { NoteRecordType } from "../domain/note.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

// A fixed map: the table name never comes from a request.
const TABLES: { readonly [K in NoteRecordType]: string } = {
  "client-organization": "client_organization",
  opportunity: "opportunity",
  project: "project",
};

export function sqliteNoteStore(db: Database): NoteStore {
  const insert = db.prepare("insert into note (id, record_type, record_id, author_id, body, created_at) values (?, ?, ?, ?, ?, ?)");
  const listFor = db.prepare(
    `select n.id, n.record_type, n.record_id, n.author_id, n.body, n.created_at, u.name as author_name
       from note n join user u on u.id = n.author_id
      where n.record_type = ? and n.record_id = ?
      order by n.rowid desc`,
  );
  const exists = Object.fromEntries(Object.entries(TABLES).map(([type, table]) => [type, db.prepare(`select 1 as found from ${table} where id = ?`)]));
  return {
    insert(n) {
      insert.run(n.id, n.recordType, n.recordId, n.authorId, n.body, n.createdAt);
    },
    listFor(recordType, recordId) {
      return (listFor.all(recordType, recordId) as Record<string, string>[]).map((r) => ({
        id: r["id"] as Id,
        recordType: r["record_type"] as NoteRecordType,
        recordId: r["record_id"] as Id,
        authorId: r["author_id"] as Id,
        body: r["body"] as string,
        createdAt: r["created_at"] as string,
        authorName: r["author_name"] as string,
      }));
    },
    recordExists(recordType, recordId) {
      return exists[recordType]?.get(recordId) !== undefined;
    },
  };
}
