import type { ScheduleInvite } from "../domain/invite.ts";
import type { ScheduleInviteStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const COLUMNS = "id, organization_id, client_user_id, title, minutes, first_day, last_day, note, status, answered_at, booking_id, created_by";

function toInvite(row: Record<string, unknown>): ScheduleInvite {
  return {
    id: row["id"] as Id,
    organizationId: row["organization_id"] as Id,
    clientUserId: row["client_user_id"] as Id,
    title: String(row["title"]),
    minutes: Number(row["minutes"]),
    firstDay: String(row["first_day"]),
    lastDay: String(row["last_day"]),
    note: String(row["note"]),
    status: row["status"] as ScheduleInvite["status"],
    answeredAt: (row["answered_at"] as string | null) ?? null,
    bookingId: (row["booking_id"] as Id | null) ?? null,
    createdBy: row["created_by"] as Id,
  };
}

export function sqliteScheduleInviteStore(db: Database): ScheduleInviteStore {
  const insert = db.prepare(`insert into schedule_invite (${COLUMNS}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare("update schedule_invite set title = ?, note = ?, status = ?, answered_at = ?, booking_id = ?, updated_at = ? where id = ?");
  const get = db.prepare(`select ${COLUMNS} from schedule_invite where id = ?`);
  const open = db.prepare(`select ${COLUMNS} from schedule_invite where status = 'open' order by created_at, rowid`);
  const forClient = db.prepare(`select ${COLUMNS} from schedule_invite where organization_id = ? order by created_at desc, rowid desc`);
  const clear = db.prepare("delete from schedule_invite_cell where invite_id = ?");
  const add = db.prepare("insert into schedule_invite_cell (invite_id, start) values (?, ?)");
  const cells = db.prepare("select start from schedule_invite_cell where invite_id = ? order by start");
  return {
    insert(i, at) {
      insert.run(i.id, i.organizationId, i.clientUserId, i.title, i.minutes, i.firstDay, i.lastDay, i.note, i.status, i.answeredAt, i.bookingId, i.createdBy, at, at);
    },
    update(i, at) {
      update.run(i.title, i.note, i.status, i.answeredAt, i.bookingId, at, i.id);
    },
    get(id) {
      const row = get.get(id);
      return row ? toInvite(row) : null;
    },
    listOpen: () => open.all().map(toInvite),
    listFor: (organizationId) => forClient.all(organizationId).map(toInvite),
    setCells(inviteId, starts) {
      clear.run(inviteId);
      for (const start of new Set(starts)) add.run(inviteId, start);
    },
    cells: (inviteId) => new Set(cells.all(inviteId).map((row) => String(row["start"]))),
  };
}
