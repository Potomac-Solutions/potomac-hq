import type { Site, SiteState } from "../domain/site.ts";
import type { SiteStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const COLUMNS = "id, organization_id, url, active, state, failures, down_since, last_checked_at, last_result, cert_expires_on, cert_warned_for";
const maybe = (value: unknown) => (value === null || value === undefined ? null : String(value));

function toSite(row: Record<string, unknown>): Site {
  return {
    id: row["id"] as Id,
    organizationId: row["organization_id"] as Id,
    url: String(row["url"]),
    active: row["active"] === 1,
    state: row["state"] as SiteState,
    failures: Number(row["failures"]),
    downSince: maybe(row["down_since"]),
    lastCheckedAt: maybe(row["last_checked_at"]),
    lastResult: String(row["last_result"]),
    certExpiresOn: maybe(row["cert_expires_on"]),
    certWarnedFor: maybe(row["cert_warned_for"]),
  };
}

export function sqliteSiteStore(db: Database): SiteStore {
  const insert = db.prepare(`insert into monitored_site (${COLUMNS}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const save = db.prepare("update monitored_site set active = ?, state = ?, failures = ?, down_since = ?, last_checked_at = ?, last_result = ?, cert_expires_on = ?, cert_warned_for = ?, updated_at = ? where id = ?");
  const get = db.prepare(`select ${COLUMNS} from monitored_site where id = ?`);
  const active = db.prepare(`select ${COLUMNS} from monitored_site where active = 1 order by url`);
  const forClient = db.prepare(`select ${COLUMNS} from monitored_site where active = 1 and organization_id = ? order by url`);
  const start = db.prepare("insert into site_outage (site_id, started_at, ended_at, reason) values (?, ?, null, ?) on conflict do nothing");
  const end = db.prepare("update site_outage set ended_at = ? where site_id = ? and ended_at is null");
  const outages = db.prepare("select started_at, ended_at, reason from site_outage where site_id = ? and (ended_at is null or ended_at >= ?) order by started_at desc");
  return {
    insert(s, at) {
      insert.run(s.id, s.organizationId, s.url, s.active ? 1 : 0, s.state, s.failures, s.downSince, s.lastCheckedAt, s.lastResult, s.certExpiresOn, s.certWarnedFor, at, at);
    },
    save(s, at) {
      save.run(s.active ? 1 : 0, s.state, s.failures, s.downSince, s.lastCheckedAt, s.lastResult.slice(0, 200), s.certExpiresOn, s.certWarnedFor, at, s.id);
    },
    get(id) {
      const row = get.get(id);
      return row ? toSite(row) : null;
    },
    listActive: () => active.all().map(toSite),
    listFor: (organizationId) => forClient.all(organizationId).map(toSite),
    startOutage(siteId, at, reason) {
      start.run(siteId, at, reason.slice(0, 200));
    },
    endOutage(siteId, at) {
      end.run(at, siteId);
    },
    outages: (siteId, from) => outages.all(siteId, from).map((row) => ({ start: String(row["started_at"]), end: maybe(row["ended_at"]), reason: String(row["reason"]) })),
  };
}
