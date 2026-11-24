import type { ReferralLink } from "../domain/link.ts";
import type { ReferralStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const COLUMNS = "id, code, label, destination, created_by";

function toLink(row: Record<string, unknown>): ReferralLink {
  return { id: row["id"] as Id, code: String(row["code"]), label: String(row["label"]), destination: String(row["destination"]), createdBy: row["created_by"] as Id };
}

export function sqliteReferralStore(db: Database): ReferralStore {
  const insert = db.prepare(`insert into referral_link (${COLUMNS}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)`);
  const save = db.prepare("update referral_link set label = ?, destination = ?, updated_at = ? where id = ?");
  const remove = db.prepare("delete from referral_link where id = ?");
  const get = db.prepare(`select ${COLUMNS} from referral_link where id = ?`);
  const byCode = db.prepare(`select ${COLUMNS} from referral_link where code = ?`);
  const list = db.prepare(`select ${COLUMNS} from referral_link order by created_at desc, code`);
  const addScan = db.prepare("insert into referral_scan (link_id, scanned_at) values (?, ?)");
  const addInquiry = db.prepare("insert into referral_inquiry (opportunity_id, link_id, received_at) values (?, ?, ?) on conflict do nothing");
  const scans = db.prepare("select count(*) as scans, coalesce(sum(scanned_at >= ?), 0) as recent, max(scanned_at) as last from referral_scan where link_id = ?");
  const inquiries = db.prepare("select opportunity_id, received_at from referral_inquiry where link_id = ? order by received_at desc");
  return {
    insert(link, at) {
      insert.run(link.id, link.code, link.label, link.destination, link.createdBy, at, at);
    },
    save(link, at) {
      save.run(link.label, link.destination, at, link.id);
    },
    remove(id) {
      remove.run(id);
    },
    get(id) {
      const row = get.get(id);
      return row ? toLink(row) : null;
    },
    byCode(code) {
      const row = byCode.get(code);
      return row ? toLink(row) : null;
    },
    list: () => list.all().map(toLink),
    addScan(linkId, at) {
      addScan.run(linkId, at);
    },
    addInquiry(linkId, opportunityId, at) {
      addInquiry.run(opportunityId, linkId, at);
    },
    counts(linkId, recentFrom) {
      const row = scans.get(recentFrom, linkId) ?? {};
      return {
        scans: Number(row["scans"] ?? 0),
        recentScans: Number(row["recent"] ?? 0),
        lastScanAt: row["last"] === null || row["last"] === undefined ? null : String(row["last"]),
        inquiries: inquiries.all(linkId).map((one) => ({ opportunityId: one["opportunity_id"] as Id, at: String(one["received_at"]) })),
      };
    },
  };
}
