// Migration 0090 (decision 0022) on a database with portal people in it: the
// client_user table is rebuilt so one email may hold access at more than one
// client, every person keeps their row, and what points at them still finds it.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "../../src/shared/infrastructure/database.ts";
import { migrate, readMigrations } from "../../src/shared/infrastructure/migrations.ts";

const all = readMigrations(join(import.meta.dirname, "..", "..", "migrations"));
const at = "2026-11-27T15:00:00.000Z";

test("portal people are kept, and an email may be at two clients but only once at each", () => {
  const dir = mkdtempSync(join(tmpdir(), "hq-many-clients-"));
  const db = openDatabase(join(dir, "hq.db"));
  try {
    migrate(
      db,
      all.filter((m) => m.version <= 89),
      () => at,
    );
    const run = (sql: string, ...values: (string | number | null)[]) => db.prepare(sql).run(...values);
    run("insert into user (id, staff_account, name, email, status, created_at, updated_at) values ('u1', 'a1', 'Mikey', 'm@example.com', 'active', ?, ?)", at, at);
    run("insert into client_organization (id, name, status, created_at, updated_at) values ('c1', 'Better Days Towing', 'active', ?, ?)", at, at);
    run("insert into client_organization (id, name, status, created_at, updated_at) values ('c2', 'Nu-Finish Collision', 'active', ?, ?)", at, at);
    run("insert into opportunity (id, organization_id, owner_id, title, service, stage, pricing, value_minor, lead_source, closed_at, created_at, updated_at) values ('o1', 'c1', 'u1', 'Website', 'website', 'won', 'fixed', 150000, 'phone', ?, ?, ?)", at, at, at);
    run("insert into project (id, organization_id, opportunity_id, owner_id, name, kind, status, created_at, updated_at) values ('p1', 'c1', 'o1', 'u1', 'Better Days website', 'fixed', 'active', ?, ?)", at, at);
    run("insert into client_user (id, organization_id, portal_account, name, email, status, invited_by, created_at, updated_at, notices) values ('cu1', 'c1', 'acct1', 'Stacy Roberts', 'stacy@example.com', 'active', 'u1', ?, ?, 0)", at, at);
    run("insert into project_update (id, project_id, user_id, client_user_id, body, created_at) values ('up1', 'p1', null, 'cu1', 'Looks good.', ?)", at);

    assert.deepEqual(
      migrate(db, all, () => at).map((m) => m.version),
      all.filter((m) => m.version > 89).map((m) => m.version),
    );

    const kept = db.prepare("select id, organization_id, portal_account, name, email, status, notices from client_user").all();
    assert.deepEqual(
      kept.map((r) => [r["id"], r["organization_id"], r["portal_account"], r["name"], r["email"], r["status"], r["notices"]]),
      [["cu1", "c1", "acct1", "Stacy Roberts", "stacy@example.com", "active", 0]],
    );
    assert.equal(db.prepare("select count(*) as n from project_update p join client_user c on c.id = p.client_user_id").get()?.["n"], 1);
    assert.deepEqual(db.prepare("pragma foreign_key_check").all(), []);

    // The same person, with the same account, at a second client.
    run("insert into client_user (id, organization_id, portal_account, name, email, status, invited_by, created_at, updated_at) values ('cu2', 'c2', 'acct1', 'Stacy Roberts', 'stacy@example.com', 'active', 'u1', ?, ?)", at, at);
    assert.throws(() => run("insert into client_user (id, organization_id, portal_account, name, email, status, invited_by, created_at, updated_at) values ('cu3', 'c2', null, 'Stacy Again', 'stacy@example.com', 'invited', 'u1', ?, ?)", at, at), /UNIQUE/);
    assert.throws(() => run("insert into client_user (id, organization_id, portal_account, name, email, status, invited_by, created_at, updated_at) values ('cu4', 'c2', null, 'No Account', 'none@example.com', 'active', 'u1', ?, ?)", at, at), /CHECK/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
