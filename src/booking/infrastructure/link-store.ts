import type { BookingLink } from "../domain/link.ts";
import type { BookingLinkStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const COLUMNS = "id, token, label, one_time, last_day, uses, withdrawn_at, created_by, created_at";

const toLink = (row: Record<string, unknown>): BookingLink => ({
  id: row["id"] as Id,
  token: String(row["token"]),
  label: String(row["label"]),
  oneTime: row["one_time"] === 1,
  lastDay: (row["last_day"] as string | null) ?? null,
  uses: Number(row["uses"]),
  withdrawnAt: (row["withdrawn_at"] as string | null) ?? null,
  createdBy: row["created_by"] as Id,
  createdAt: String(row["created_at"]),
});

export function sqliteBookingLinkStore(db: Database): BookingLinkStore {
  const add = db.prepare(`insert into booking_link (${COLUMNS}) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const list = db.prepare(`select ${COLUMNS} from booking_link order by created_at desc, rowid desc`);
  const get = db.prepare(`select ${COLUMNS} from booking_link where id = ?`);
  const byToken = db.prepare(`select ${COLUMNS} from booking_link where token = ?`);
  const claim = db.prepare("update booking_link set uses = uses + 1 where id = ? and withdrawn_at is null and (one_time = 0 or uses = 0)");
  const release = db.prepare("update booking_link set uses = uses - 1 where id = ? and uses > 0");
  const withdraw = db.prepare("update booking_link set withdrawn_at = ? where id = ? and withdrawn_at is null");
  const one = (row: Record<string, unknown> | undefined) => (row ? toLink(row) : null);
  return {
    add(link) {
      add.run(link.id, link.token, link.label, link.oneTime ? 1 : 0, link.lastDay, link.uses, link.withdrawnAt, link.createdBy, link.createdAt);
    },
    list: () => list.all().map(toLink),
    get: (id) => one(get.get(id)),
    byToken: (token) => one(byToken.get(token)),
    claim: (id) => Number(claim.run(id).changes) > 0,
    release(id) {
      release.run(id);
    },
    withdraw: (id, at) => Number(withdraw.run(at, id).changes) > 0,
  };
}
