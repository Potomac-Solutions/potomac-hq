// Migration 0041 (decision 0007, section 1) on a database with work in it:
// the task table is rebuilt so a task needn't have a project, every to-do
// moves into it, and nothing that pointed at a task loses it.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "../../src/shared/infrastructure/database.ts";
import { migrate, readMigrations } from "../../src/shared/infrastructure/migrations.ts";

const all = readMigrations(join(import.meta.dirname, "..", "..", "migrations"));
const at = "2026-11-20T15:00:00.000Z";

test("tasks keep their time and labels, to-dos become tasks without a project, and the rules still hold", () => {
  const dir = mkdtempSync(join(tmpdir(), "hq-inbox-"));
  const db = openDatabase(join(dir, "hq.db"));
  try {
    migrate(
      db,
      all.filter((m) => m.version <= 40),
      () => at,
    );
    const run = (sql: string, ...values: (string | number | null)[]) => db.prepare(sql).run(...values);
    run("insert into user (id, staff_account, name, email, status, created_at, updated_at) values ('u1', 'a1', 'Mikey', 'm@example.com', 'active', ?, ?)", at, at);
    run("insert into client_organization (id, name, status, created_at, updated_at) values ('c1', 'Better Days Towing', 'active', ?, ?)", at, at);
    run("insert into opportunity (id, organization_id, owner_id, title, stage, lead_source, created_at, updated_at) values ('o1', 'c1', 'u1', 'New site', 'new', 'phone', ?, ?)", at, at);
    run("insert into opportunity (id, organization_id, owner_id, title, service, stage, pricing, value_minor, lead_source, closed_at, created_at, updated_at) values ('o2', 'c1', 'u1', 'Website', 'website', 'won', 'fixed', 150000, 'phone', ?, ?, ?)", at, at, at);
    run("insert into project (id, organization_id, opportunity_id, owner_id, name, kind, status, created_at, updated_at) values ('p1', 'c1', 'o2', 'u1', 'Better Days website', 'fixed', 'active', ?, ?)", at, at);
    run("insert into task (id, project_id, title, assignee_id, priority, status, created_at, updated_at) values ('t1', 'p1', 'Send the proof', 'u1', 'high', 'todo', ?, ?)", at, at);
    run("insert into task (id, project_id, title, priority, status, done_at, created_at, updated_at) values ('t2', 'p1', 'Point the domain', 'normal', 'done', ?, ?, ?)", at, at, at);
    run("insert into time_entry (id, project_id, task_id, user_id, worked_on, minutes, created_at, updated_at) values ('e1', 'p1', 't1', 'u1', '2026-11-20', 45, ?, ?)", at, at);
    run("insert into label (id, name, name_key, colour, created_at, updated_at) values ('l1', 'Website', 'website', 'blue', ?, ?)", at, at);
    run("insert into task_label (task_id, label_id) values ('t1', 'l1')");
    run("insert into todo (id, title, due_on, assignee_id, organization_id, opportunity_id, created_by, created_at, updated_at) values ('d1', 'Call Squeak back', '2026-11-21', 'u1', 'c1', 'o1', 'u1', ?, ?)", at, at);
    run("insert into todo (id, title, assignee_id, done_at, created_by, created_at, updated_at) values ('d2', 'Renew the domain', 'u1', ?, 'u1', ?, ?)", at, at, at);

    assert.deepEqual(
      migrate(db, all, () => at).map((m) => m.version),
      [41, ...all.filter((m) => m.version > 41).map((m) => m.version)],
    );

    const rows = db.prepare("select id, project_id, title, status, done_at, due_on, assignee_id, organization_id, opportunity_id, created_by from task order by id").all();
    assert.deepEqual(
      rows.map((r) => [r["id"], r["project_id"], r["status"], r["organization_id"], r["opportunity_id"]]),
      [
        ["d1", null, "todo", "c1", "o1"],
        ["d2", null, "done", null, null],
        ["t1", "p1", "todo", null, null],
        ["t2", "p1", "done", null, null],
      ],
    );
    assert.equal(rows.find((r) => r["id"] === "d1")?.["due_on"], "2026-11-21");
    assert.equal(rows.find((r) => r["id"] === "d2")?.["done_at"], at);
    assert.equal(db.prepare("select count(*) as n from sqlite_master where name = 'todo'").get()?.["n"], 0, "the todo table is gone");
    assert.deepEqual(db.prepare("pragma foreign_key_check").all(), [], "every reference still resolves");
    assert.equal(db.prepare("select task_id from time_entry where id = 'e1'").get()?.["task_id"], "t1");
    assert.equal(db.prepare("select label_id from task_label where task_id = 't1'").get()?.["label_id"], "l1");

    // References are still enforced after the rebuild.
    assert.throws(() => run("insert into task_label (task_id, label_id) values ('missing', 'l1')"), /FOREIGN KEY/);
    // A task without a project is a to-do: someone's, with no phase, to do or done.
    assert.throws(() => run("insert into task (id, title, priority, status, created_at, updated_at) values ('x1', 'Nobody', 'normal', 'todo', ?, ?)", at, at), /CHECK/);
    assert.throws(() => run("insert into task (id, title, assignee_id, priority, status, created_at, updated_at) values ('x2', 'Doing', 'u1', 'normal', 'doing', ?, ?)", at, at), /CHECK/);
    run("insert into task (id, title, assignee_id, priority, status, created_at, updated_at) values ('x3', 'Fine', 'u1', 'normal', 'todo', ?, ?)", at, at);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
