import type { Database } from "../../shared/adapters.ts";
import type { IntakeStore } from "../application/intake.ts";
import type { Id } from "../../shared/index.ts";

type Row = Record<string, unknown>;

export function sqliteIntakeStore(db: Database): IntakeStore {
  const get = db.prepare("select organization_id, answers, sent_by, sent_at, updated_at from client_intake where organization_id = ?");
  const save = db.prepare(
    `insert into client_intake (organization_id, answers, sent_by, sent_at, updated_at) values (?, ?, ?, ?, ?)
     on conflict (organization_id) do update set answers = excluded.answers, sent_by = excluded.sent_by, updated_at = excluded.updated_at`,
  );
  return {
    get: (organizationId) => {
      const row = get.get(organizationId) as Row | undefined;
      return row ? { organizationId: row["organization_id"] as Id, answers: JSON.parse(row["answers"] as string), sentBy: row["sent_by"] as Id, sentAt: row["sent_at"] as string, updatedAt: row["updated_at"] as string } : null;
    },
    save: (r) => void save.run(r.organizationId, JSON.stringify(r.answers), r.sentBy, r.sentAt, r.updatedAt),
  };
}

export function sqliteIntakeLookups(db: Database) {
  const newest = db.prepare("select id, name from project where organization_id = ? and status = 'active' order by created_at desc limit 1");
  const name = db.prepare("select name from client_user where id = ?");
  return {
    newestProject: (organizationId: Id) => {
      const row = newest.get(organizationId) as Row | undefined;
      return row ? { id: row["id"] as Id, name: row["name"] as string } : null;
    },
    clientUserName: (id: Id) => ((name.get(id) as Row | undefined)?.["name"] as string | undefined) ?? "",
  };
}
