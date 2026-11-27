import type { CallRow, CallStore, ClientUserStore, EventReader, LoggedEvent, UpdateRow, UpdateStore } from "../application/ports.ts";
import type { CallRequest, CallStatus, ClientUser, ClientUserStatus } from "../domain/client-user.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

type Row = Record<string, string | number | null>;
const text = (row: Row, key: string) => row[key] as string;
const maybe = (row: Row, key: string) => (row[key] ?? null) as string | null;

const toUser = (r: Row): ClientUser => ({
  id: text(r, "id") as Id,
  organizationId: text(r, "organization_id") as Id,
  portalAccount: maybe(r, "portal_account"),
  name: text(r, "name"),
  email: text(r, "email"),
  status: text(r, "status") as ClientUserStatus,
  invitedBy: text(r, "invited_by") as Id,
});

export function sqliteClientUserStore(db: Database): ClientUserStore {
  const cols = "id, organization_id, portal_account, name, email, status, invited_by";
  const insert = db.prepare(`insert into client_user (${cols}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // The organization is not in this list: a client user never moves to another client.
  const update = db.prepare("update client_user set portal_account = ?, name = ?, status = ?, updated_at = ? where id = ?");
  const get = db.prepare(`select ${cols} from client_user where id = ?`);
  const atClient = db.prepare(`select ${cols} from client_user where organization_id = ? and email = ?`);
  const allByEmail = db.prepare(`select ${cols} from client_user where email = ? order by created_at, rowid`);
  const allByAccount = db.prepare(`select ${cols} from client_user where portal_account = ? order by created_at, rowid`);
  const listFor = db.prepare(`select ${cols} from client_user where organization_id = ? order by name collate nocase`);
  const read = (r: Row | undefined) => (r ? toUser(r) : null);
  const notices = db.prepare("select notices from client_user where id = ?");
  const setNotices = db.prepare("update client_user set notices = ?, updated_at = ? where id = ?");
  const recipients = db.prepare("select id, name, email from client_user where organization_id = ? and status = 'active' and notices = 1 order by name collate nocase");
  return {
    wantsNotices: (id) => notices.get(id)?.["notices"] === 1,
    setNotices(id, on, at) {
      setNotices.run(on ? 1 : 0, at, id);
    },
    noticeRecipients: (organizationId) => (recipients.all(organizationId) as { id: string; name: string; email: string }[]).map((r) => ({ id: r.id as Id, name: r.name, email: r.email })),
    insert(u, at) {
      insert.run(u.id, u.organizationId, u.portalAccount, u.name, u.email, u.status, u.invitedBy, at, at);
    },
    update(u, at) {
      update.run(u.portalAccount, u.name, u.status, at, u.id);
    },
    get: (id) => read(get.get(id) as Row | undefined),
    atClient: (organizationId, email) => read(atClient.get(organizationId, email.trim().toLowerCase()) as Row | undefined),
    allByEmail: (email) => (allByEmail.all(email.trim().toLowerCase()) as Row[]).map(toUser),
    allByAccount: (account) => (allByAccount.all(account) as Row[]).map(toUser),
    listFor: (organizationId) => (listFor.all(organizationId) as Row[]).map(toUser),
  };
}

export function sqliteUpdateStore(db: Database): UpdateStore {
  const insert = db.prepare("insert into project_update (id, project_id, user_id, client_user_id, body, created_at) values (?, ?, ?, ?, ?, ?)");
  const listFor = db.prepare(
    `select p.id, p.project_id, p.user_id, p.client_user_id, p.body, p.created_at, coalesce(u.name, c.name) as author_name
       from project_update p left join user u on u.id = p.user_id left join client_user c on c.id = p.client_user_id
      where p.project_id = ? order by p.rowid desc`,
  );
  return {
    insert(u) {
      insert.run(u.id, u.projectId, u.userId, u.clientUserId, u.body, u.createdAt);
    },
    listFor(projectId) {
      return (listFor.all(projectId) as Row[]).map(
        (r): UpdateRow => ({
          id: text(r, "id") as Id,
          projectId: text(r, "project_id") as Id,
          userId: maybe(r, "user_id") as Id | null,
          clientUserId: maybe(r, "client_user_id") as Id | null,
          body: text(r, "body"),
          createdAt: text(r, "created_at"),
          authorName: text(r, "author_name"),
          fromClient: r["client_user_id"] !== null,
        }),
      );
    },
  };
}

const toCall = (r: Row): CallRequest => ({
  id: text(r, "id") as Id,
  organizationId: text(r, "organization_id") as Id,
  clientUserId: text(r, "client_user_id") as Id,
  wanted: text(r, "wanted"),
  note: text(r, "note"),
  phone: text(r, "phone"),
  status: text(r, "status") as CallStatus,
  confirmedFor: maybe(r, "confirmed_for"),
  reply: text(r, "reply"),
  answeredBy: maybe(r, "answered_by") as Id | null,
});

export function sqliteCallStore(db: Database): CallStore {
  const cols = "id, organization_id, client_user_id, wanted, note, phone, status, confirmed_for, reply, answered_by";
  const insert = db.prepare(`insert into call_request (${cols}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare("update call_request set status = ?, confirmed_for = ?, reply = ?, answered_by = ?, updated_at = ? where id = ?");
  const get = db.prepare(`select ${cols} from call_request where id = ?`);
  const joined = `select ${cols.split(", ").map((c) => `r.${c}`).join(", ")}, r.created_at, u.name as client_user_name, o.name as organization_name
       from call_request r join client_user u on u.id = r.client_user_id join client_organization o on o.id = r.organization_id`;
  const listFor = db.prepare(`${joined} where r.organization_id = ? order by r.rowid desc`);
  const waiting = db.prepare(`${joined} where r.status = 'requested' order by r.rowid`);
  const row = (r: Row): CallRow => ({ ...toCall(r), clientUserName: text(r, "client_user_name"), organizationName: text(r, "organization_name"), createdAt: text(r, "created_at") });
  return {
    insert(c, at) {
      insert.run(c.id, c.organizationId, c.clientUserId, c.wanted, c.note, c.phone, c.status, c.confirmedFor, c.reply, c.answeredBy, at, at);
    },
    update(c, at) {
      update.run(c.status, c.confirmedFor, c.reply, c.answeredBy, at, c.id);
    },
    get(id) {
      const r = get.get(id) as Row | undefined;
      return r ? toCall(r) : null;
    },
    listFor: (organizationId) => (listFor.all(organizationId) as Row[]).map(row),
    waiting: () => (waiting.all() as Row[]).map(row),
  };
}

type EventRow = { position: number; id: string; occurred_at: string; actor_id: string | null; action: string; record_id: string; context: string };

const toEvent = (r: EventRow): LoggedEvent => ({ position: r.position, id: r.id, occurredAt: r.occurred_at, actorId: r.actor_id as Id | null, action: r.action, recordId: r.record_id, context: JSON.parse(r.context) as Record<string, unknown> });

/** Reads the activity log for the notice sender and the dashboard. It only ever selects from it. */
export function sqliteEventReader(db: Database): EventReader {
  const cols = "rowid as position, id, occurred_at, actor_id, action, record_id, context";
  const after = db.prepare(`select ${cols} from activity_event where rowid > ? order by rowid limit ?`);
  // The actions are passed as one JSON list, so no SQL is built from them.
  const recent = db.prepare(`select ${cols} from activity_event where action in (select value from json_each(?)) and occurred_at >= ? order by rowid desc limit ?`);
  const cursor = db.prepare("select last_rowid from notice_cursor where id = 1");
  const setCursor = db.prepare("update notice_cursor set last_rowid = ?, updated_at = ? where id = 1");
  return {
    after: (position, limit) => (after.all(position, limit) as EventRow[]).map(toEvent),
    recent: (actions, since, limit) => (recent.all(JSON.stringify(actions), since, limit) as EventRow[]).map(toEvent),
    cursor: () => Number(cursor.get()?.["last_rowid"] ?? 0),
    setCursor(position, at) {
      setCursor.run(position, at);
    },
  };
}
