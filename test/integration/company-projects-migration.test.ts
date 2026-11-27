// Migration 0089 (decision 0021) on a database with work in it: the project
// table is rebuilt so a project needn't have a client, every project keeps
// its row, and what points at a project still finds it.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "../../src/shared/infrastructure/database.ts";
import { migrate, readMigrations } from "../../src/shared/infrastructure/migrations.ts";

const all = readMigrations(join(import.meta.dirname, "..", "..", "migrations"));
const at = "2026-11-27T15:00:00.000Z";

test("client projects are kept, a company project may have neither client nor opportunity, but not one without the other", () => {
  const dir = mkdtempSync(join(tmpdir(), "hq-company-"));
  const db = openDatabase(join(dir, "hq.db"));
  try {
    migrate(
      db,
      all.filter((m) => m.version <= 88),
      () => at,
    );
    const run = (sql: string, ...values: (string | number | null)[]) => db.prepare(sql).run(...values);
    run("insert into user (id, staff_account, name, email, status, created_at, updated_at) values ('u1', 'a1', 'Mikey', 'm@example.com', 'active', ?, ?)", at, at);
    run("insert into client_organization (id, name, status, created_at, updated_at) values ('c1', 'Better Days Towing', 'active', ?, ?)", at, at);
    run("insert into opportunity (id, organization_id, owner_id, title, service, stage, pricing, value_minor, lead_source, closed_at, created_at, updated_at) values ('o1', 'c1', 'u1', 'Website', 'website', 'won', 'fixed', 150000, 'phone', ?, ?, ?)", at, at, at);
    run("insert into project (id, organization_id, opportunity_id, owner_id, name, kind, status, description, health, start_on, created_at, updated_at) values ('p1', 'c1', 'o1', 'u1', 'Better Days website', 'fixed', 'active', 'Rebuild.', 'at-risk', '2026-11-20', ?, ?)", at, at);
    run("insert into task (id, project_id, title, assignee_id, priority, status, created_at, updated_at) values ('t1', 'p1', 'Send the proof', 'u1', 'high', 'todo', ?, ?)", at, at);
    run("insert into time_entry (id, project_id, task_id, user_id, worked_on, minutes, created_at, updated_at) values ('e1', 'p1', 't1', 'u1', '2026-11-20', 45, ?, ?)", at, at);
    run("insert into expense (id, project_id, category, amount_minor, spent_on, recorded_by, created_at) values ('x1', 'p1', 'hosting', 1200, '2026-11-20', 'u1', ?)", at);

    assert.deepEqual(
      migrate(db, all, () => at).map((m) => m.version),
      all.filter((m) => m.version > 88).map((m) => m.version),
    );

    const kept = db.prepare("select id, organization_id, opportunity_id, name, description, health, start_on from project").all();
    assert.deepEqual(
      kept.map((r) => [r["id"], r["organization_id"], r["opportunity_id"], r["name"], r["description"], r["health"], r["start_on"]]),
      [["p1", "c1", "o1", "Better Days website", "Rebuild.", "at-risk", "2026-11-20"]],
    );
    assert.equal(db.prepare("select count(*) as n from task t join project p on p.id = t.project_id").get()?.["n"], 1);
    assert.equal(db.prepare("select count(*) as n from time_entry t join project p on p.id = t.project_id").get()?.["n"], 1);
    assert.deepEqual(db.prepare("pragma foreign_key_check").all(), []);

    run("insert into project (id, organization_id, opportunity_id, owner_id, name, kind, status, created_at, updated_at) values ('p2', null, null, 'u1', 'Training', 'ongoing', 'active', ?, ?)", at, at);
    assert.throws(() => run("insert into project (id, organization_id, opportunity_id, owner_id, name, kind, status, created_at, updated_at) values ('p3', 'c1', null, 'u1', 'Half', 'fixed', 'active', ?, ?)", at, at), /CHECK/);
    assert.throws(() => run("insert into project (id, organization_id, opportunity_id, owner_id, name, kind, status, created_at, updated_at) values ('p4', 'c1', 'o1', 'u1', 'Twice', 'fixed', 'active', ?, ?)", at, at), /UNIQUE/);

    // Migration 0090: the expense table keeps its rows and takes the two new categories.
    run("insert into expense (id, project_id, category, amount_minor, spent_on, recorded_by, created_at) values ('x2', 'p2', 'training', 30000, '2026-11-27', 'u1', ?)", at);
    run("insert into expense (id, project_id, category, amount_minor, spent_on, recorded_by, created_at) values ('x3', 'p2', 'licenses', 10000, '2026-11-27', 'u1', ?)", at);
    assert.deepEqual(db.prepare("select id, category from expense order by id").all().map((r) => [r["id"], r["category"]]), [["x1", "hosting"], ["x2", "training"], ["x3", "licenses"]]);
    assert.throws(() => run("insert into expense (id, project_id, category, amount_minor, spent_on, recorded_by, created_at) values ('x4', 'p2', 'snacks', 100, '2026-11-27', 'u1', ?)", at), /CHECK/);

    const granted = db.prepare("select r.key from role_permission p join role r on r.id = p.role_id where p.permission = 'project.start' order by r.key").all().map((r) => r["key"]);
    assert.deepEqual(granted, ["admin", "manager"]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
