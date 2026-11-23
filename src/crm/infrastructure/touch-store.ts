import type { Outcome, Touch, TouchKind } from "../domain/touch.ts";
import type { TouchStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const COLUMNS = "id, organization_id, opportunity_id, contact_id, kind, outcome, note, happened_at, user_id";
const toTouch = (row: Record<string, unknown>): Touch => ({
  id: row["id"] as Id,
  organizationId: row["organization_id"] as Id,
  opportunityId: (row["opportunity_id"] as Id | null) ?? null,
  contactId: (row["contact_id"] as Id | null) ?? null,
  kind: row["kind"] as TouchKind,
  outcome: (row["outcome"] as Outcome | null) ?? null,
  note: String(row["note"]),
  happenedAt: String(row["happened_at"]),
  userId: row["user_id"] as Id,
});

export function sqliteTouchStore(db: Database): TouchStore {
  const insert = db.prepare(`insert into touch (${COLUMNS}, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const forClient = db.prepare(`select ${COLUMNS} from touch where organization_id = ? order by happened_at desc limit ?`);
  const forOpportunity = db.prepare(`select ${COLUMNS} from touch where opportunity_id = ? order by happened_at desc limit ?`);
  const last = db.prepare("select organization_id, max(happened_at) as at from touch group by organization_id");
  const lastActive = db.prepare(
    `select o.id, max(o.updated_at, coalesce((select max(t.happened_at) from touch t where t.organization_id = o.organization_id), '')) as at
       from opportunity o where o.stage not in ('won', 'lost')`,
  );
  return {
    insert(t, at) {
      insert.run(t.id, t.organizationId, t.opportunityId, t.contactId, t.kind, t.outcome, t.note, t.happenedAt, t.userId, at);
    },
    listForClient: (organizationId, limit) => forClient.all(organizationId, limit).map(toTouch),
    listForOpportunity: (opportunityId, limit) => forOpportunity.all(opportunityId, limit).map(toTouch),
    lastActiveByOpportunity: () => new Map(lastActive.all().map((row) => [row["id"] as Id, String(row["at"])])),
    lastByClient: () => new Map(last.all().map((row) => [row["organization_id"] as Id, String(row["at"])])),
  };
}
