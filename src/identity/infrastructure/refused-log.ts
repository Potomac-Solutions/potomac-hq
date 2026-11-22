import type { RefusedAttempt, RefusedLog } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

export function sqliteRefusedLog(db: Database): RefusedLog {
  const insert = db.prepare("insert into refused_attempt (id, occurred_at, kind, user_id, email, address, detail) values (?, ?, ?, ?, ?, ?, ?)");
  const since = db.prepare("select id, occurred_at, kind, user_id, email, address, detail from refused_attempt where occurred_at >= ? order by occurred_at desc, id desc limit ?");
  const count = db.prepare("select count(*) as n from refused_attempt where occurred_at >= ?");
  const prune = db.prepare("delete from refused_attempt where occurred_at < ?");
  return {
    append(attempt) {
      insert.run(attempt.id, attempt.occurredAt, attempt.kind, attempt.userId, attempt.email, attempt.address, attempt.detail);
    },
    since(instant, limit) {
      return since.all(instant, limit).map((row) => ({
        id: row["id"] as Id,
        occurredAt: String(row["occurred_at"]),
        kind: row["kind"] as RefusedAttempt["kind"],
        userId: (row["user_id"] as Id | null) ?? null,
        email: (row["email"] as string | null) ?? null,
        address: String(row["address"]),
        detail: String(row["detail"]),
      }));
    },
    countSince: (instant) => Number(count.get(instant)?.["n"] ?? 0),
    prune: (before) => Number(prune.run(before).changes),
  };
}
