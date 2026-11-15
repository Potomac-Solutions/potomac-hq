import type { ActivityLog } from "../application/ports.ts";
import type { Database } from "./database.ts";

/** Writes activity events to the append-only activity_event table. */
export function sqliteActivityLog(db: Database): ActivityLog {
  const insert = db.prepare(
    `insert into activity_event (id, occurred_at, actor_id, action, record_type, record_id, context)
     values (?, ?, ?, ?, ?, ?, ?)`,
  );
  return {
    append(event) {
      insert.run(
        event.id,
        event.occurredAt,
        event.actorId,
        event.action,
        event.recordType,
        event.recordId,
        JSON.stringify(event.context),
      );
    },
  };
}
