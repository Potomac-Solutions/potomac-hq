import type { ActivityReader, ActivityRow, AuditFilter, AuditReader, AuditRow } from "../application/ports.ts";
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
  const oneRecord = db.prepare(`${select} where e.record_type = ? and e.record_id = ? ${order}`);
  return {
    forRecord: (recordType, recordId, limit) => oneRecord.all(recordType, recordId, limit).map((row) => ({ ...row })) as ActivityRow[],
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

/** Reads the full audit history. A read model: it only ever selects. */
export function sqliteAuditReader(db: Database): AuditReader {
  // One statement, with each filter switched off by an empty value, so no
  // SQL is ever built from what someone typed.
  const where = `
     where (:actor = '' or (:actor = 'none' and e.actor_id is null) or e.actor_id = :actor)
       and (:recordType = '' or e.record_type = :recordType)
       and (:action = '' or substr(e.action, 1, length(:action)) = :action)
       and (:from = '' or e.occurred_at >= :from)
       and (:until = '' or e.occurred_at < :until)`;
  const search = db.prepare(
    `select e.id, e.occurred_at as occurredAt, e.action, u.name as actorName, e.record_type as recordType, e.record_id as recordId, e.context
       from activity_event e left join user u on u.id = e.actor_id ${where}
      order by e.rowid desc limit :limit offset :offset`,
  );
  const count = db.prepare(`select count(*) as n from activity_event e ${where}`);
  const types = db.prepare("select distinct record_type as t from activity_event order by record_type");
  const named = (filter: AuditFilter) => ({ ":actor": filter.actor, ":recordType": filter.recordType, ":action": filter.action, ":from": filter.from, ":until": filter.until });
  return {
    search(filter, limit, offset) {
      return search.all({ ...named(filter), ":limit": limit, ":offset": offset }).map((row) => ({ ...row })) as AuditRow[];
    },
    count(filter) {
      return count.get(named(filter))?.["n"] as number;
    },
    recordTypes() {
      return (types.all() as { t: string }[]).map((row) => row.t);
    },
  };
}
