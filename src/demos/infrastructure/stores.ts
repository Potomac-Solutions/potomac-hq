import type { Demo } from "../domain/demo.ts";
import type { DemoLinkStore, DemoStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const DEMO = "id, name, url, description, sign_in, active";
const toDemo = (row: Record<string, unknown>): Demo => ({ id: row["id"] as Id, name: String(row["name"]), url: String(row["url"]), description: String(row["description"]), signIn: String(row["sign_in"]), active: Number(row["active"]) === 1 });

export function sqliteDemoStore(db: Database): DemoStore {
  const get = db.prepare(`select ${DEMO} from demo where id = ?`);
  const list = db.prepare(`select ${DEMO} from demo order by name`);
  const insert = db.prepare(`insert into demo (${DEMO}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)`);
  const save = db.prepare("update demo set name = ?, url = ?, description = ?, sign_in = ?, active = ?, updated_at = ? where id = ?");
  const sent = db.prepare("select 1 as one from demo_link where demo_id = ? limit 1");
  const remove = db.prepare("delete from demo where id = ?");
  return {
    get(id) {
      const row = get.get(id);
      return row ? toDemo(row) : null;
    },
    list: () => list.all().map(toDemo),
    insert(d, at) {
      insert.run(d.id, d.name, d.url, d.description, d.signIn, d.active ? 1 : 0, at, at);
    },
    save(d, at) {
      save.run(d.name, d.url, d.description, d.signIn, d.active ? 1 : 0, at, d.id);
    },
    everSent: (id) => sent.get(id) !== undefined,
    remove(id) {
      remove.run(id);
    },
  };
}

export function sqliteDemoLinkStore(db: Database): DemoLinkStore {
  const insert = db.prepare("insert into demo_link (id, code, demo_id, opportunity_id, sent_by, sent_at) values (?, ?, ?, ?, ?, ?)");
  const byCode = db.prepare("select id, code, demo_id, opportunity_id, sent_at from demo_link where code = ?");
  const forOpp = db.prepare("select l.id, l.code, l.demo_id, l.opportunity_id, l.sent_at, count(o.link_id) as opens, max(o.opened_at) as last from demo_link l left join demo_open o on o.link_id = l.id where l.opportunity_id = ? group by l.id order by l.sent_at desc, l.rowid desc");
  const addOpen = db.prepare("insert into demo_open (link_id, opened_at) values (?, ?)");
  const since = db.prepare("select l.opportunity_id, max(o.opened_at) as last, count(*) as opens, group_concat(distinct d.name) as demos from demo_open o join demo_link l on l.id = o.link_id join demo d on d.id = l.demo_id where o.opened_at >= ? group by l.opportunity_id order by last desc");
  const toLink = (row: Record<string, unknown>) => ({ id: row["id"] as Id, code: String(row["code"]), demoId: row["demo_id"] as Id, opportunityId: row["opportunity_id"] as Id, sentAt: String(row["sent_at"]) });
  return {
    insert(link) {
      insert.run(link.id, link.code, link.demoId, link.opportunityId, link.sentBy, link.sentAt);
    },
    byCode(code) {
      const row = byCode.get(code);
      return row ? toLink(row) : null;
    },
    forOpportunity: (opportunityId) => forOpp.all(opportunityId).map((row) => ({ ...toLink(row), opens: Number(row["opens"]), lastOpenedAt: row["last"] === null ? null : String(row["last"]) })),
    addOpen(linkId, at) {
      addOpen.run(linkId, at);
    },
    openedSince: (instant) => since.all(instant).map((row) => ({ opportunityId: row["opportunity_id"] as Id, lastOpenedAt: String(row["last"]), opens: Number(row["opens"]), demos: String(row["demos"] ?? "").split(",").filter(Boolean) })),
  };
}
