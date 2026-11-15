import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { recentActivity, type RecentActivityDeps } from "../application/recent-activity.ts";
import { sqliteUserStore } from "../../identity/adapters.ts";
import type { RoleKey } from "../../identity/index.ts";
import { migrate, newId, openDatabase, readMigrations, systemClock, type Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";
import { formatWhenIn, sqliteActivityReader } from "./activity-reader.ts";

const migrationsDir = join(import.meta.dirname, "..", "..", "..", "migrations");

let dir: string;
let db: Database;
let deps: RecentActivityDeps;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hq-dashboard-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db, readMigrations(migrationsDir), systemClock);
  deps = { users: sqliteUserStore(db), activity: sqliteActivityReader(db), formatWhen: formatWhenIn("America/New_York") };
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function user(role: RoleKey, name: string): Id {
  const id = newId();
  db.prepare("insert into user (id, staff_account, name, email, status, created_at, updated_at) values (?, ?, ?, ?, 'active', 'now', 'now')").run(id, `acct-${id}`, name, `${id}@example.com`);
  db.prepare("insert into user_role (user_id, role_id) select ?, id from role where key = ?").run(id, role);
  return id;
}

function event(at: string, actor: Id | null, action: string, recordType: string): void {
  db.prepare("insert into activity_event (id, occurred_at, actor_id, action, record_type, record_id) values (?, ?, ?, ?, ?, ?)").run(newId(), at, actor, action, recordType, newId());
}

test("an admin sees every event, newest first, with the actor's name and a local time", () => {
  const admin = user("admin", "Mikey Nichols");
  event("2026-11-15T02:03:00Z", admin, "user.signed-in", "user");
  event("2026-11-15T02:04:00Z", null, "user.reset-link-issued", "user");
  event("2026-11-15T02:05:00Z", admin, "opportunity.stage-changed", "opportunity");

  const result = recentActivity(deps, admin);
  assert.ok(result.ok);
  assert.equal(result.value.everything, true);
  assert.deepEqual(
    result.value.items.map((item) => [item.text, item.when, item.whenIso]),
    [
      ["Mikey Nichols opportunity.stage-changed", "Nov 14, 2026, 9:05 PM", "2026-11-15T02:05:00Z"],
      ["A password reset link was issued", "Nov 14, 2026, 9:04 PM", "2026-11-15T02:04:00Z"],
      ["Mikey Nichols signed in", "Nov 14, 2026, 9:03 PM", "2026-11-15T02:03:00Z"],
    ],
  );
});

test("a member sees activity on client records only, never sign-ins or user changes", () => {
  const admin = user("admin", "Mikey Nichols");
  const member = user("member", "New Hire");
  event("2026-11-15T02:01:00Z", admin, "user.signed-in", "user");
  event("2026-11-15T02:02:00Z", admin, "user.created", "user");
  event("2026-11-15T02:03:00Z", admin, "client.created", "client-organization");
  event("2026-11-15T02:04:00Z", member, "opportunity.created", "opportunity");

  for (const viewer of [member, user("manager", "A Manager")]) {
    const result = recentActivity(deps, viewer);
    assert.ok(result.ok);
    assert.equal(result.value.everything, false);
    assert.deepEqual(result.value.items.map((item) => item.text), ["New Hire opportunity.created", "Mikey Nichols client.created"]);
  }
});

test("events are listed in the order they were written, even if the clock was stepped back", () => {
  const admin = user("admin", "Mikey Nichols");
  event("2026-11-15T02:05:00Z", admin, "user.signed-in", "user");
  event("2026-11-15T02:04:59Z", admin, "user.signed-out", "user");
  const result = recentActivity(deps, admin);
  assert.ok(result.ok);
  assert.deepEqual(result.value.items.map((item) => item.text), ["Mikey Nichols signed out", "Mikey Nichols signed in"]);
});

test("only the newest twenty are returned", () => {
  const admin = user("admin", "Mikey Nichols");
  for (let i = 0; i < 25; i++) event(`2026-11-15T02:${String(i).padStart(2, "0")}:00Z`, admin, "user.signed-in", "user");
  const result = recentActivity(deps, admin);
  assert.ok(result.ok);
  assert.equal(result.value.items.length, 20);
  assert.equal(result.value.items[0]?.whenIso, "2026-11-15T02:24:00Z");
  assert.equal(result.value.items[19]?.whenIso, "2026-11-15T02:05:00Z");
});

test("someone with no user, and a disabled user, are refused", () => {
  const admin = user("admin", "Mikey Nichols");
  event("2026-11-15T02:03:00Z", admin, "user.signed-in", "user");
  assert.deepEqual(recentActivity(deps, newId()), { ok: false, error: "forbidden" });
  assert.deepEqual(recentActivity(deps, null), { ok: false, error: "forbidden" });
  db.prepare("update user set status = 'disabled' where id = ?").run(admin);
  assert.deepEqual(recentActivity(deps, admin), { ok: false, error: "forbidden" });
});

test("an empty table is an empty list", () => {
  const result = recentActivity(deps, user("admin", "Mikey Nichols"));
  assert.deepEqual(result, { ok: true, value: { items: [], everything: true } });
});
