import type { EventKind, SiteQrCode } from "../domain/code.ts";
import type { SiteQrStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const COLUMNS = "id, organization_id, code, label, site, page, retired";

function toCode(row: Record<string, unknown>): SiteQrCode {
  return { id: row["id"] as Id, organizationId: row["organization_id"] as Id, code: String(row["code"]), label: String(row["label"]), site: String(row["site"]), page: String(row["page"]), retired: Number(row["retired"]) === 1 };
}

export function sqliteSiteQrStore(db: Database): SiteQrStore {
  const insert = db.prepare(`insert into site_qr_code (${COLUMNS}, created_by, created_by_client_user, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const save = db.prepare("update site_qr_code set label = ?, retired = ?, updated_at = ? where id = ?");
  const remove = db.prepare("delete from site_qr_code where id = ?");
  const get = db.prepare(`select ${COLUMNS} from site_qr_code where id = ?`);
  const byCode = db.prepare(`select ${COLUMNS} from site_qr_code where organization_id = ? and code = ?`);
  const listFor = db.prepare(`select ${COLUMNS} from site_qr_code where organization_id = ? order by created_at desc, code`);
  const addEvent = db.prepare("insert into site_qr_event (code_id, kind, happened_at, received_at) values (?, ?, ?, ?)");
  const counts = db.prepare(
    `select coalesce(sum(kind = 'scan'), 0) as scans, coalesce(sum(kind = 'scan' and happened_at >= ?), 0) as recent,
            coalesce(sum(kind = 'call'), 0) as calls, coalesce(sum(kind = 'text'), 0) as texts, coalesce(sum(kind = 'email'), 0) as emails,
            max(case when kind = 'scan' then happened_at end) as last
       from site_qr_event where code_id = ?`,
  );
  const hasEvents = db.prepare("select 1 from site_qr_event where code_id = ? limit 1");
  const lastHeard = db.prepare("select max(event.received_at) as last from site_qr_event event join site_qr_code code on code.id = event.code_id where code.organization_id = ?");
  return {
    insert(code, by, at) {
      insert.run(code.id, code.organizationId, code.code, code.label, code.site, code.page, code.retired ? 1 : 0, "userId" in by ? by.userId : null, "clientUserId" in by ? by.clientUserId : null, at, at);
    },
    save(code, at) {
      save.run(code.label, code.retired ? 1 : 0, at, code.id);
    },
    remove(id) {
      remove.run(id);
    },
    get(id) {
      const row = get.get(id);
      return row ? toCode(row) : null;
    },
    byCode(organizationId, code) {
      const row = byCode.get(organizationId, code);
      return row ? toCode(row) : null;
    },
    listFor: (organizationId) => listFor.all(organizationId).map(toCode),
    addEvent(codeId: Id, kind: EventKind, happenedAt: string, receivedAt: string) {
      addEvent.run(codeId, kind, happenedAt, receivedAt);
    },
    counts(codeId, recentFrom) {
      const row = counts.get(recentFrom, codeId) ?? {};
      return {
        scans: Number(row["scans"] ?? 0),
        recentScans: Number(row["recent"] ?? 0),
        calls: Number(row["calls"] ?? 0),
        texts: Number(row["texts"] ?? 0),
        emails: Number(row["emails"] ?? 0),
        lastScanAt: row["last"] === null || row["last"] === undefined ? null : String(row["last"]),
      };
    },
    hasEvents: (codeId) => hasEvents.get(codeId) !== undefined,
    lastHeard(organizationId) {
      const last = lastHeard.get(organizationId)?.["last"];
      return last === null || last === undefined ? null : String(last);
    },
  };
}
