import type { CalendarLink, CalendarLinkStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

export function sqliteCalendarLinkStore(db: Database): CalendarLinkStore {
  const list = db.prepare("select id, label, url, added_by, added_at, checked_at, problem from calendar_link order by added_at, rowid");
  const add = db.prepare("insert into calendar_link (id, label, url, added_by, added_at, checked_at, problem) values (?, ?, ?, ?, ?, ?, ?)");
  const remove = db.prepare("delete from calendar_link where id = ?");
  const checked = db.prepare("update calendar_link set checked_at = ?, problem = ? where id = ?");
  return {
    list: () => list.all().map((row) => ({ id: row["id"] as Id, label: String(row["label"]), url: String(row["url"]), addedBy: row["added_by"] as Id, addedAt: String(row["added_at"]), checkedAt: (row["checked_at"] as string | null) ?? null, problem: String(row["problem"]) })),
    add(link) {
      add.run(link.id, link.label, link.url, link.addedBy, link.addedAt, link.checkedAt, link.problem);
    },
    remove: (id) => Number(remove.run(id).changes) > 0,
    checked(id, at, problem) {
      checked.run(at, problem, id);
    },
  };
}
