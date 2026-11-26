import type { Database } from "../../shared/adapters.ts";
import type { TextConsent, TextingStore } from "../application/texting.ts";
import type { Id } from "../../shared/index.ts";

type Row = Record<string, unknown>;
const toConsent = (r: Row): TextConsent => ({ clientUserId: r["client_user_id"] as Id, organizationId: r["organization_id"] as Id, phone: r["phone"] as string, agreedAt: r["agreed_at"] as string, stoppedAt: (r["stopped_at"] as string | null) ?? null });

export function sqliteTextingStore(db: Database): TextingStore {
  const get = db.prepare("select * from text_consent where client_user_id = ?");
  const agree = db.prepare(
    `insert into text_consent (client_user_id, organization_id, phone, agreed_at, stopped_at, stopped_by) values (?, ?, ?, ?, null, null)
       on conflict (client_user_id) do update set organization_id = excluded.organization_id, phone = excluded.phone, agreed_at = excluded.agreed_at, stopped_at = null, stopped_by = null`,
  );
  const stop = db.prepare("update text_consent set stopped_at = ?, stopped_by = ? where client_user_id = ? and stopped_at is null");
  const forOrg = db.prepare(
    `select t.* from text_consent t join client_user u on u.id = t.client_user_id
      where t.organization_id = ? and t.stopped_at is null and u.status = 'active' order by t.agreed_at`,
  );
  const log = db.prepare("insert into text_sent (id, client_user_id, purpose, body, sent_at, outcome) values (?, ?, ?, ?, ?, ?)");
  return {
    consent: (id) => {
      const r = get.get(id) as Row | undefined;
      return r ? toConsent(r) : null;
    },
    agree: (c) => void agree.run(c.clientUserId, c.organizationId, c.phone, c.agreedAt),
    stop: (id, at, by) => void stop.run(at, by, id),
    forOrganization: (id) => (forOrg.all(id) as Row[]).map(toConsent),
    logSent: (e) => void log.run(e.id, e.clientUserId, e.purpose, e.body, e.sentAt, e.outcome),
  };
}
