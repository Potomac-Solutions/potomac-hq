import type { CallRow, CallStore, ClientUserStore, UpdateRow, UpdateStore } from "../application/ports.ts";
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
  const one = (where: string) => db.prepare(`select ${cols} from client_user where ${where} = ?`);
  const get = one("id");
  const byEmail = one("email");
  const byAccount = one("portal_account");
  const listFor = db.prepare(`select ${cols} from client_user where organization_id = ? order by name collate nocase`);
  const read = (r: Row | undefined) => (r ? toUser(r) : null);
  return {
    insert(u, at) {
      insert.run(u.id, u.organizationId, u.portalAccount, u.name, u.email, u.status, u.invitedBy, at, at);
    },
    update(u, at) {
      update.run(u.portalAccount, u.name, u.status, at, u.id);
    },
    get: (id) => read(get.get(id) as Row | undefined),
    byEmail: (email) => read(byEmail.get(email) as Row | undefined),
    byPortalAccount: (account) => read(byAccount.get(account) as Row | undefined),
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
  status: text(r, "status") as CallStatus,
  confirmedFor: maybe(r, "confirmed_for"),
  reply: text(r, "reply"),
  answeredBy: maybe(r, "answered_by") as Id | null,
});

export function sqliteCallStore(db: Database): CallStore {
  const cols = "id, organization_id, client_user_id, wanted, note, status, confirmed_for, reply, answered_by";
  const insert = db.prepare(`insert into call_request (${cols}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare("update call_request set status = ?, confirmed_for = ?, reply = ?, answered_by = ?, updated_at = ? where id = ?");
  const get = db.prepare(`select ${cols} from call_request where id = ?`);
  const joined = `select ${cols.split(", ").map((c) => `r.${c}`).join(", ")}, r.created_at, u.name as client_user_name, o.name as organization_name
       from call_request r join client_user u on u.id = r.client_user_id join client_organization o on o.id = r.organization_id`;
  const listFor = db.prepare(`${joined} where r.organization_id = ? order by r.rowid desc`);
  const waiting = db.prepare(`${joined} where r.status = 'requested' order by r.rowid`);
  const row = (r: Row): CallRow => ({ ...toCall(r), clientUserName: text(r, "client_user_name"), organizationName: text(r, "organization_name"), createdAt: text(r, "created_at") });
  return {
    insert(c, at) {
      insert.run(c.id, c.organizationId, c.clientUserId, c.wanted, c.note, c.status, c.confirmedFor, c.reply, c.answeredBy, at, at);
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
