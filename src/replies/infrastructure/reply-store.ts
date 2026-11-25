// Saved replies (migration 0079).
import type { ReplyStore } from "../application/replies.ts";
import type { Database } from "../../shared/adapters.ts";

export function sqliteReplyStore(db: Database): ReplyStore {
  const list = db.prepare("select id, title, body from saved_reply where removed_at is null order by title collate nocase");
  const get = db.prepare("select id, title, body from saved_reply where id = ? and removed_at is null");
  const insert = db.prepare("insert into saved_reply (id, title, body, created_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?)");
  const update = db.prepare("update saved_reply set title = ?, body = ?, updated_at = ? where id = ? and removed_at is null");
  const remove = db.prepare("update saved_reply set removed_at = ? where id = ? and removed_at is null");
  const toReply = (row: Record<string, unknown>) => ({ id: String(row["id"]), title: String(row["title"]), body: String(row["body"]) });
  return {
    list: () => list.all().map(toReply),
    get(id) {
      const row = get.get(id);
      return row ? toReply(row) : null;
    },
    insert: (r, by, at) => void insert.run(r.id, r.title, r.body, by, at, at),
    update: (r, at) => void update.run(r.title, r.body, at, r.id),
    remove: (id, at) => Number(remove.run(at, id).changes) > 0,
  };
}
