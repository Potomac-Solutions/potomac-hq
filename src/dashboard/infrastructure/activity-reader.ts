import type { ActivityReader, ActivityRow } from "../application/ports.ts";
import { CLIENT_RECORD_TYPES } from "../domain/activity-feed.ts";
import type { Database } from "../../shared/adapters.ts";

/** Reads the activity panel's rows. A read model: it only ever selects. */
export function sqliteActivityReader(db: Database): ActivityReader {
  const select = `
    select e.id, e.occurred_at as occurredAt, e.action, u.name as actorName
      from activity_event e
      left join user u on u.id = e.actor_id`;
  // Newest first by the order events were written. The log is append-only, so
  // that order is the truth even if the server's clock is ever stepped back.
  const order = "order by e.rowid desc limit ?";
  const everything = db.prepare(`${select} ${order}`);
  const clientRecords = db.prepare(
    `${select} where e.record_type in (${CLIENT_RECORD_TYPES.map(() => "?").join(", ")}) ${order}`,
  );
  return {
    recent(scope, limit) {
      const rows = scope === "everything" ? everything.all(limit) : clientRecords.all(...CLIENT_RECORD_TYPES, limit);
      return rows.map((row) => ({ ...row })) as ActivityRow[];
    },
  };
}

/** "Nov 14, 2026, 9:03 PM" in the business time zone (docs/data-model.md). */
export function formatWhenIn(zone: string): (instant: string) => string {
  return (instant) =>
    Temporal.Instant.from(instant)
      .toZonedDateTimeISO(zone)
      .toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
