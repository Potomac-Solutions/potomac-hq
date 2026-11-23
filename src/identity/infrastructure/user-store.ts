import type { InviteStore, UserStore } from "../application/ports.ts";
import type { Access } from "../domain/access.ts";
import { isPermission, isRoleKey, ROLE_KEYS, type Permission, type RoleKey } from "../domain/permissions.ts";
import { isTheme } from "../domain/theme.ts";
import type { User, UserInvite, UserStatus } from "../domain/user.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

type UserRow = { id: string; staff_account: string; name: string; email: string; status: string };

function toUser(row: UserRow): User {
  return {
    id: row.id as Id,
    staffAccount: row.staff_account,
    name: row.name,
    email: row.email,
    status: row.status as UserStatus,
  };
}

export function sqliteUserStore(db: Database): UserStore {
  const columns = "id, staff_account, name, email, status";
  const countUsers = db.prepare("select count(*) as n from user");
  const insertUser = db.prepare(
    `insert into user (${columns}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertUserRole = db.prepare(
    "insert into user_role (user_id, role_id) select ?, id from role where key = ?",
  );
  const byId = db.prepare(`select ${columns} from user where id = ?`);
  const byStaffAccount = db.prepare(`select ${columns} from user where staff_account = ?`);
  const permissionsFor = db.prepare(
    `select distinct rp.permission
       from user_role ur
       join role_permission rp on rp.role_id = ur.role_id
      where ur.user_id = ?`,
  );

  const listUsers = db.prepare(`select ${columns} from user order by name collate nocase, id`);
  const themeOf = db.prepare("select theme from user_preference where user_id = ?");
  const setTheme = db.prepare(
    `insert into user_preference (user_id, theme, updated_at) values (?, ?, ?)
     on conflict (user_id) do update set theme = excluded.theme, updated_at = excluded.updated_at`,
  );
  const morningOf = db.prepare("select morning_email from user_preference where user_id = ?");
  const setMorning = db.prepare(
    `insert into user_preference (user_id, theme, morning_email, updated_at) values (?, 'system', ?, ?)
     on conflict (user_id) do update set morning_email = excluded.morning_email, updated_at = excluded.updated_at`,
  );
  const byEmail = db.prepare(`select ${columns} from user where email = ?`);
  const rolesOf = db.prepare("select r.key from user_role ur join role r on r.id = ur.role_id where ur.user_id = ?");
  const clearRoles = db.prepare("delete from user_role where user_id = ?");
  const setStatus = db.prepare("update user set status = ?, updated_at = ? where id = ?");
  const touch = db.prepare("update user set updated_at = ? where id = ?");
  const otherAdmins = db.prepare(
    `select count(*) as n from user u join user_role ur on ur.user_id = u.id join role r on r.id = ur.role_id
      where r.key = 'admin' and u.status = 'active' and u.id <> ?`,
  );
  return {
    findByEmail(email) {
      const row = byEmail.get(email) as UserRow | undefined;
      return row ? toUser(row) : null;
    },
    rolesOf(userId) {
      const held = (rolesOf.all(userId) as { key: string }[]).map((row) => row.key);
      return ROLE_KEYS.filter((key) => held.includes(key));
    },
    setRoles(userId, roles, at) {
      clearRoles.run(userId);
      for (const role of roles) {
        if (insertUserRole.run(userId, role).changes !== 1) throw new Error(`Unknown role: ${role}`);
      }
      touch.run(at, userId);
    },
    setStatus(userId, status, at) {
      setStatus.run(status, at, userId);
    },
    activeAdminsOtherThan(userId) {
      return otherAdmins.get(userId)?.["n"] as number;
    },
    get(userId) {
      const row = byId.get(userId) as UserRow | undefined;
      return row ? toUser(row) : null;
    },
    list() {
      return (listUsers.all() as UserRow[]).map(toUser);
    },
    themeOf(userId) {
      const theme = (themeOf.get(userId) as { theme: string } | undefined)?.theme;
      return theme !== undefined && isTheme(theme) ? theme : "system";
    },
    setTheme(userId, theme, at) {
      setTheme.run(userId, theme, at);
    },
    morningEmailOf(userId) {
      return (morningOf.get(userId) as { morning_email: number } | undefined)?.morning_email !== 0;
    },
    setMorningEmail(userId, on, at) {
      setMorning.run(userId, on ? 1 : 0, at);
    },
    count() {
      return countUsers.get()?.["n"] as number;
    },
    insert(user, roles, at) {
      insertUser.run(user.id, user.staffAccount, user.name, user.email, user.status, at, at);
      for (const role of roles) {
        const result = insertUserRole.run(user.id, role);
        if (result.changes !== 1) throw new Error(`Unknown role: ${role}`);
      }
    },
    accessFor(userId): Access | null {
      const row = byId.get(userId) as UserRow | undefined;
      if (!row) return null;
      const permissions = new Set<Permission>();
      for (const { permission } of permissionsFor.all(userId) as { permission: string }[]) {
        // A stored permission the code no longer knows is ignored, never granted.
        if (isPermission(permission)) permissions.add(permission);
      }
      return { user: toUser(row), permissions };
    },
    findByStaffAccount(staffAccount) {
      const row = byStaffAccount.get(staffAccount) as UserRow | undefined;
      return row ? toUser(row) : null;
    },
  };
}

type InviteRow = { id: string; email: string; name: string; roles: string; invited_by: string; created_at: string };

function toInvite(row: InviteRow): UserInvite & { createdAt: string } {
  const roles = (JSON.parse(row.roles) as unknown[]).filter((key): key is RoleKey => typeof key === "string" && isRoleKey(key));
  return { id: row.id as Id, email: row.email, name: row.name, roles, invitedBy: row.invited_by as Id, createdAt: row.created_at };
}

export function sqliteInviteStore(db: Database): InviteStore {
  const columns = "id, email, name, roles, invited_by, created_at";
  const insert = db.prepare(`insert into user_invite (${columns}) values (?, ?, ?, ?, ?, ?)`);
  const byEmail = db.prepare(`select ${columns} from user_invite where email = ?`);
  const byId = db.prepare(`select ${columns} from user_invite where id = ?`);
  const all = db.prepare(`select ${columns} from user_invite order by created_at, id`);
  const remove = db.prepare("delete from user_invite where id = ?");
  const removeOld = db.prepare("delete from user_invite where created_at < ?");
  return {
    insert(invite, at) {
      insert.run(invite.id, invite.email, invite.name, JSON.stringify(invite.roles), invite.invitedBy, at);
    },
    byEmail(email) {
      const row = byEmail.get(email) as InviteRow | undefined;
      return row ? toInvite(row) : null;
    },
    get(id) {
      const row = byId.get(id) as InviteRow | undefined;
      return row ? toInvite(row) : null;
    },
    list() {
      return (all.all() as InviteRow[]).map(toInvite);
    },
    remove(id) {
      remove.run(id);
    },
    removeOlderThan(instant) {
      return Number(removeOld.run(instant).changes);
    },
  };
}
