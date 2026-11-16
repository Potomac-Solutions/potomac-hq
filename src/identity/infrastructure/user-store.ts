import type { UserStore } from "../application/ports.ts";
import type { Access } from "../domain/access.ts";
import { isPermission, type Permission } from "../domain/permissions.ts";
import { isTheme } from "../domain/theme.ts";
import type { User, UserStatus } from "../domain/user.ts";
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
  return {
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
