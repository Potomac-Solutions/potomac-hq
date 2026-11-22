import type { Booking } from "../domain/booking.ts";
import type { Weekday } from "../domain/hours.ts";
import type { BookingStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const COLUMNS = "id, kind, status, starts_at, ends_at, name, email, phone, topic, organization_id, client_user_id, host_id, created_at, cancelled_at, cancelled_by, cancel_reason";

function toBooking(row: Record<string, unknown>): Booking {
  return {
    id: row["id"] as Id,
    kind: row["kind"] as Booking["kind"],
    status: row["status"] as Booking["status"],
    start: String(row["starts_at"]),
    end: String(row["ends_at"]),
    name: String(row["name"]),
    email: String(row["email"]),
    phone: String(row["phone"]),
    topic: String(row["topic"]),
    organizationId: (row["organization_id"] as Id | null) ?? null,
    clientUserId: (row["client_user_id"] as Id | null) ?? null,
    hostId: row["host_id"] as Id,
    createdAt: String(row["created_at"]),
    cancelledAt: (row["cancelled_at"] as string | null) ?? null,
    cancelledBy: (row["cancelled_by"] as Booking["cancelledBy"]) ?? null,
    cancelReason: String(row["cancel_reason"]),
  };
}

export function sqliteBookingStore(db: Database): BookingStore {
  const settings = db.prepare("select host_id, call_minutes, gap_minutes, notice_hours, days_ahead, portal_open, public_open from booking_setting where id = 1");
  const hours = db.prepare("select weekday, start, end from booking_hours order by weekday, start");
  const saveSettings = db.prepare(
    "insert into booking_setting (id, host_id, call_minutes, gap_minutes, notice_hours, days_ahead, portal_open, public_open, updated_at) values (1, ?, ?, ?, ?, ?, ?, ?, ?) on conflict (id) do update set host_id = excluded.host_id, call_minutes = excluded.call_minutes, gap_minutes = excluded.gap_minutes, notice_hours = excluded.notice_hours, days_ahead = excluded.days_ahead, portal_open = excluded.portal_open, public_open = excluded.public_open, updated_at = excluded.updated_at",
  );
  const clearHours = db.prepare("delete from booking_hours");
  const addHours = db.prepare("insert into booking_hours (weekday, start, end) values (?, ?, ?)");
  const closed = db.prepare("select day, note from booking_closed_day where day >= ? order by day");
  const close = db.prepare("insert into booking_closed_day (day, note) values (?, ?) on conflict (day) do update set note = excluded.note");
  const open = db.prepare("delete from booking_closed_day where day = ?");
  const booked = db.prepare(`select ${COLUMNS} from booking where status = 'booked' and starts_at < ? and ends_at > ? order by starts_at`);
  const between = db.prepare(`select ${COLUMNS} from booking where starts_at >= ? and starts_at < ? order by starts_at`);
  const forOrganization = db.prepare(`select ${COLUMNS} from booking where organization_id = ? and ends_at >= ? order by starts_at`);
  const get = db.prepare(`select ${COLUMNS} from booking where id = ?`);
  const byHash = db.prepare(`select ${COLUMNS} from booking where manage_hash = ?`);
  const add = db.prepare(`insert into booking (${COLUMNS}, manage_hash) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const save = db.prepare("update booking set status = ?, starts_at = ?, ends_at = ?, phone = ?, topic = ?, cancelled_at = ?, cancelled_by = ?, cancel_reason = ? where id = ?");
  return {
    settings() {
      const row = settings.get();
      if (!row) return null;
      return {
        hostId: row["host_id"] as Id,
        callMinutes: Number(row["call_minutes"]),
        gapMinutes: Number(row["gap_minutes"]),
        noticeHours: Number(row["notice_hours"]),
        daysAhead: Number(row["days_ahead"]),
        portalOpen: row["portal_open"] === 1,
        publicOpen: row["public_open"] === 1,
        hours: hours.all().map((one) => ({ weekday: Number(one["weekday"]) as Weekday, start: Number(one["start"]), end: Number(one["end"]) })),
      };
    },
    saveSettings(value, at) {
      saveSettings.run(value.hostId, value.callMinutes, value.gapMinutes, value.noticeHours, value.daysAhead, value.portalOpen ? 1 : 0, value.publicOpen ? 1 : 0, at);
      clearHours.run();
      for (const range of value.hours) addHours.run(range.weekday, range.start, range.end);
    },
    closedDays: (fromDay) => closed.all(fromDay).map((row) => ({ day: String(row["day"]), note: String(row["note"]) })),
    closeDay(day) {
      close.run(day.day, day.note);
    },
    openDay: (day) => Number(open.run(day).changes) > 0,
    booked: (from, to) => booked.all(to, from).map(toBooking),
    between: (from, to) => between.all(from, to).map(toBooking),
    forOrganization: (organizationId, from) => forOrganization.all(organizationId, from).map(toBooking),
    get(id) {
      const row = get.get(id);
      return row ? toBooking(row) : null;
    },
    byManageHash(hash) {
      const row = byHash.get(hash);
      return row ? toBooking(row) : null;
    },
    add(b, manageHash) {
      add.run(b.id, b.kind, b.status, b.start, b.end, b.name, b.email, b.phone, b.topic, b.organizationId, b.clientUserId, b.hostId, b.createdAt, b.cancelledAt, b.cancelledBy, b.cancelReason, manageHash);
    },
    save(b) {
      save.run(b.status, b.start, b.end, b.phone, b.topic, b.cancelledAt, b.cancelledBy, b.cancelReason, b.id);
    },
  };
}
