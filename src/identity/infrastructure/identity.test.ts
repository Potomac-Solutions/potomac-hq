// The identity services against a real database built from the repo's
// migrations.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { authorize } from "../application/authorize.ts";
import { createFirstAdmin, type CreateFirstAdminDeps } from "../application/create-first-admin.ts";
import { PERMISSIONS, ROLE_GRANTS, ROLE_KEYS, type RoleKey } from "../domain/permissions.ts";
import { newUser, type User } from "../domain/user.ts";
import { migrate, newId, openDatabase, readMigrations, sqliteActivityLog, sqliteTransact, systemClock, type Database } from "../../shared/adapters.ts";
import { sqliteUserStore } from "./user-store.ts";

const migrationsDir = join(import.meta.dirname, "..", "..", "..", "migrations");

let dir: string;
let db: Database;
let deps: CreateFirstAdminDeps;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hq-identity-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db, readMigrations(migrationsDir), systemClock);
  deps = {
    users: sqliteUserStore(db),
    activityLog: sqliteActivityLog(db),
    transact: sqliteTransact(db),
    clock: systemClock,
    newId,
  };
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function events(): { actor_id: string | null; action: string; record_type: string; record_id: string; context: string }[] {
  return db
    .prepare("select actor_id, action, record_type, record_id, context from activity_event order by occurred_at, id")
    .all()
    .map((row) => ({ ...row })) as never;
}

function addUser(role: RoleKey | null, over: { status?: "disabled" } = {}): User {
  const n = deps.users.count() + 1;
  const made = newUser({ id: newId(), staffAccount: `acct-${n}`, name: `User ${n}`, email: `user${n}@example.com` });
  assert.ok(made.ok);
  deps.users.insert(made.value, role ? [role] : [], systemClock());
  if (over.status) db.prepare("update user set status = ? where id = ?").run(over.status, made.value.id);
  return made.value;
}

const mikey = { staffAccount: "acct-owner", name: "Mikey Nichols", email: "Mikey@Example.com" };

test("the seeded roles grant exactly what the code says", () => {
  for (const role of ROLE_KEYS) {
    const rows = db
      .prepare("select rp.permission from role r join role_permission rp on rp.role_id = r.id where r.key = ? order by 1")
      .all(role) as { permission: string }[];
    assert.deepEqual(rows.map((r) => r.permission), [...ROLE_GRANTS[role]].sort(), role);
  }
  assert.equal(db.prepare("select count(*) as n from role").get()?.["n"], ROLE_KEYS.length);
});

test("the first admin is created, can do everything, and the creation is recorded", () => {
  const result = createFirstAdmin(deps, mikey);
  assert.ok(result.ok);
  const user = result.value;
  assert.equal(user.email, "mikey@example.com");

  for (const action of PERMISSIONS) assert.equal(authorize(deps, user.id, action).ok, true, action);
  assert.deepEqual(deps.users.findByStaffAccount("acct-owner"), user);
  assert.deepEqual(events(), [
    { actor_id: user.id, action: "user.created", record_type: "user", record_id: user.id, context: '{"roles":["admin"],"first":true}' },
  ]);
});

test("a second first-admin is refused, and nothing is written", () => {
  assert.ok(createFirstAdmin(deps, mikey).ok);
  const again = createFirstAdmin(deps, { staffAccount: "acct-intruder", name: "Someone Else", email: "else@example.com" });
  assert.deepEqual(again, { ok: false, error: "already-set-up" });
  assert.equal(deps.users.count(), 1);
  assert.equal(events().length, 1);
  assert.equal(deps.users.findByStaffAccount("acct-intruder"), null);
});

test("an invalid first admin is refused, and nothing is written", () => {
  assert.deepEqual(createFirstAdmin(deps, { ...mikey, email: "not-an-email" }), { ok: false, error: "invalid-email" });
  assert.equal(deps.users.count(), 0);
  assert.equal(events().length, 0);
});

test("if the activity event cannot be written, the user is not created", () => {
  const broken: CreateFirstAdminDeps = {
    ...deps,
    activityLog: {
      append() {
        throw new Error("audit table unavailable");
      },
    },
  };
  assert.throws(() => createFirstAdmin(broken, mikey), /audit table unavailable/);
  assert.equal(deps.users.count(), 0);
});

test("each role is authorized for exactly its permissions, from stored rows", () => {
  for (const role of ROLE_KEYS) {
    const user = addUser(role);
    for (const action of PERMISSIONS) {
      const expected = ROLE_GRANTS[role].includes(action);
      assert.equal(authorize(deps, user.id, action).ok, expected, `${role} ${action}`);
    }
  }
});

test("a member is refused deal values and user management", () => {
  const member = addUser("member");
  for (const action of ["opportunity.view-value", "opportunity.set-value", "user.invite", "user.set-roles", "activity.view-all"]) {
    assert.deepEqual(authorize(deps, member.id, action), { ok: false, error: "forbidden" }, action);
  }
});

test("a disabled admin is refused everything", () => {
  const admin = addUser("admin", { status: "disabled" });
  for (const action of PERMISSIONS) assert.deepEqual(authorize(deps, admin.id, action), { ok: false, error: "forbidden" }, action);
});

test("a user with no roles, an unknown user and no user are refused", () => {
  const nobody = addUser(null);
  for (const actor of [nobody.id, newId(), null]) {
    assert.deepEqual(authorize(deps, actor, "client.view"), { ok: false, error: "forbidden" });
  }
});

test("an action outside the matrix is refused even for an admin", () => {
  const admin = addUser("admin");
  for (const action of ["client.delete", "activity.delete", "", "*"]) {
    assert.deepEqual(authorize(deps, admin.id, action), { ok: false, error: "forbidden" }, action);
  }
});

test("a permission stored in the database that the code does not know is not granted", () => {
  const member = addUser("member");
  db.prepare("insert into role_permission (role_id, permission) select id, 'client.delete' from role where key = 'member'").run();
  assert.equal(deps.users.accessFor(member.id)?.permissions.has("client.delete" as never), false);
  assert.deepEqual(authorize(deps, member.id, "client.delete"), { ok: false, error: "forbidden" });
});

test("roles are read from storage on every check", () => {
  const user = addUser("member");
  assert.equal(authorize(deps, user.id, "user.invite").ok, false);
  db.prepare("insert into user_role (user_id, role_id) select ?, id from role where key = 'admin'").run(user.id);
  assert.equal(authorize(deps, user.id, "user.invite").ok, true);
  db.prepare("update user set status = 'disabled' where id = ?").run(user.id);
  assert.equal(authorize(deps, user.id, "user.invite").ok, false);
});

test("the database refuses a duplicate email, an upper-case email and an unknown status", () => {
  addUser("member");
  const insert = db.prepare("insert into user (id, staff_account, name, email, status, created_at, updated_at) values (?, ?, 'X', ?, ?, 'now', 'now')");
  assert.throws(() => insert.run(newId(), "acct-x", "user1@example.com", "active"), /UNIQUE/i);
  assert.throws(() => insert.run(newId(), "acct-y", "Upper@Example.com", "active"), /CHECK/i);
  assert.throws(() => insert.run(newId(), "acct-z", "ok@example.com", "deleted"), /CHECK/i);
  assert.throws(() => db.prepare("insert into user_role (user_id, role_id) values (?, 'no-such-role')").run(newId()), /FOREIGN KEY/i);
});
