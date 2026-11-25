// Calls in progress (decision 0009, migration 0052).
import type { Call } from "../domain/call.ts";
import type { BookedCall, CallStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const COLUMNS = "id, organization_id, contact_id, opportunity_id, booking_id, user_id, phone, started_at, planned_minutes, warn_minutes, note, ended_at, touch_id, guide, return_to, recap_sent_at";
type Row = Record<string, unknown>;
const toCall = (row: Row): Call => ({
  id: row["id"] as Id,
  organizationId: row["organization_id"] as Id,
  contactId: (row["contact_id"] as Id | null) ?? null,
  opportunityId: (row["opportunity_id"] as Id | null) ?? null,
  bookingId: (row["booking_id"] as Id | null) ?? null,
  userId: row["user_id"] as Id,
  phone: String(row["phone"] ?? ""),
  startedAt: String(row["started_at"]),
  plannedMinutes: Number(row["planned_minutes"]),
  warnMinutes: Number(row["warn_minutes"]),
  note: String(row["note"] ?? ""),
  endedAt: (row["ended_at"] as string | null) ?? null,
  touchId: (row["touch_id"] as Id | null) ?? null,
  guide: (row["guide"] as string | null) ?? null,
  returnTo: (row["return_to"] as string | null) ?? null,
  recapSentAt: (row["recap_sent_at"] as string | null) ?? null,
});

const toBooked = (row: Row): BookedCall => ({
  id: row["id"] as Id,
  organizationId: (row["organization_id"] as Id | null) ?? null,
  name: String(row["name"]),
  phone: String(row["phone"] ?? ""),
  topic: String(row["topic"] ?? ""),
  startsAt: String(row["starts_at"]),
  endsAt: String(row["ends_at"]),
  booked: row["status"] === "booked",
});

export function sqliteCallScreenStore(db: Database): CallStore {
  const insert = db.prepare(`insert into call (${COLUMNS}, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const one = db.prepare(`select ${COLUMNS} from call where id = ?`);
  const open = db.prepare(`select ${COLUMNS} from call where user_id = ? and ended_at is null`);
  const update = db.prepare("update call set planned_minutes = ?, warn_minutes = ?, note = ?, guide = ? where id = ? and ended_at is null");
  const end = db.prepare("update call set ended_at = ?, touch_id = ? where id = ? and ended_at is null");
  const recapSent = db.prepare("update call set recap_sent_at = ? where id = ? and ended_at is not null and recap_sent_at is null");
  const stale = db.prepare(`select ${COLUMNS} from call where ended_at is null and started_at <= ? order by started_at`);
  // A public booking added to the CRM keeps its client in crm_client_id.
  const booking = db.prepare("select id, coalesce(organization_id, crm_client_id) as organization_id, name, phone, topic, starts_at, ends_at, status from booking where id = ?");
  const between = db.prepare("select id, coalesce(organization_id, crm_client_id) as organization_id, name, phone, topic, starts_at, ends_at, status from booking where host_id = ? and status = 'booked' and starts_at >= ? and starts_at <= ? order by starts_at");
  const forBooking = db.prepare(`select ${COLUMNS} from call where booking_id = ? order by started_at desc limit 1`);
  return {
    insert(c, at) {
      insert.run(c.id, c.organizationId, c.contactId, c.opportunityId, c.bookingId, c.userId, c.phone, c.startedAt, c.plannedMinutes, c.warnMinutes, c.note, c.endedAt, c.touchId, c.guide, c.returnTo, c.recapSentAt, at);
    },
    get: (id) => {
      const row = one.get(id) as Row | undefined;
      return row ? toCall(row) : null;
    },
    openFor: (userId) => {
      const row = open.get(userId) as Row | undefined;
      return row ? toCall(row) : null;
    },
    update(c) {
      update.run(c.plannedMinutes, c.warnMinutes, c.note, c.guide, c.id);
    },
    end(id, endedAt, touchId) {
      end.run(endedAt, touchId, id);
    },
    recapSent: (id, at) => recapSent.run(at, id).changes === 1,
    openStartedBy: (instant) => stale.all(instant).map((row) => toCall(row as Row)),
    booking: (id) => {
      const row = booking.get(id) as Row | undefined;
      return row ? toBooked(row) : null;
    },
    bookedBetween: (hostId, from, to) => between.all(hostId, from, to).map((row) => toBooked(row as Row)),
    forBooking: (bookingId) => {
      const row = forBooking.get(bookingId) as Row | undefined;
      return row ? toCall(row) : null;
    },
  };
}
