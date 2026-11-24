// Migration 0052 (decision 0008, section 1) on a database with projects and
// tasks in it: keys from names, taken ones with a digit, odd names given a
// key that works, and numbers in the order tasks were made.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "../../src/shared/infrastructure/database.ts";
import { migrate, readMigrations } from "../../src/shared/infrastructure/migrations.ts";

const all = readMigrations(join(import.meta.dirname, "..", "..", "migrations"));
const at = (minute: number) => `2026-11-20T15:${String(minute).padStart(2, "0")}:00.000Z`;

test("existing projects get keys from their names, and tasks numbers in the order they were made", () => {
  const dir = mkdtempSync(join(tmpdir(), "hq-keys-"));
  const db = openDatabase(join(dir, "hq.db"));
  try {
    migrate(db, all.filter((m) => m.version <= 51), () => at(0));
    const run = (sql: string, ...values: (string | number | null)[]) => db.prepare(sql).run(...values);
    run("insert into user (id, staff_account, name, email, status, created_at, updated_at) values ('u1', 'a1', 'Mikey', 'm@example.com', 'active', ?, ?)", at(0), at(0));
    run("insert into client_organization (id, name, status, created_at, updated_at) values ('c1', 'Better Days Towing', 'active', ?, ?)", at(0), at(0));
    const projects: [string, string][] = [["p1", "Better Days website"], ["p2", "Better Days Wash"], ["p3", "Tailgate"], ["p4", "Café Olé"], ["p5", "日本の店"], ["p6", "Total Old Digital Ops"], ["p7", "3 Rivers"], ["p8", "Inventory"]];
    projects.forEach(([id, name], n) => {
      run("insert into opportunity (id, organization_id, owner_id, title, service, stage, pricing, value_minor, lead_source, closed_at, created_at, updated_at) values (?, 'c1', 'u1', ?, 'website', 'won', 'fixed', 100000, 'phone', ?, ?, ?)", `o${id}`, name, at(n + 1), at(n + 1), at(n + 1));
      run("insert into project (id, organization_id, opportunity_id, owner_id, name, kind, status, created_at, updated_at) values (?, 'c1', ?, 'u1', ?, 'fixed', 'active', ?, ?)", id, `o${id}`, name, at(n + 1), at(n + 1));
    });
    run("insert into task (id, project_id, title, priority, status, created_at, updated_at) values ('t2', 'p1', 'Second', 'normal', 'todo', ?, ?)", at(20), at(20));
    run("insert into task (id, project_id, title, priority, status, created_at, updated_at) values ('t1', 'p1', 'First', 'normal', 'todo', ?, ?)", at(10), at(10));
    run("insert into task (id, project_id, title, priority, status, created_at, updated_at) values ('t3', 'p2', 'Other', 'normal', 'todo', ?, ?)", at(10), at(10));
    run("insert into task (id, project_id, title, assignee_id, priority, status, created_at, updated_at) values ('d1', null, 'A to-do', 'u1', 'normal', 'todo', ?, ?)", at(30), at(30));
    run("insert into task (id, project_id, title, assignee_id, priority, status, created_at, updated_at) values ('d2', null, 'Another', 'u1', 'normal', 'todo', ?, ?)", at(31), at(31));

    migrate(db, all, () => at(59));

    const keys = Object.fromEntries((db.prepare("select id, key from project").all() as { id: string; key: string }[]).map((r) => [r.id, r.key]));
    assert.deepEqual(keys, { p1: "BDW", p2: "BDW2", p3: "TAI", p4: "CO", p5: "PRJ", p6: "TODO2", p7: "P3R", p8: "INV2" });
    const numbers = Object.fromEntries((db.prepare("select id, number from task").all() as { id: string; number: number }[]).map((r) => [r.id, r.number]));
    assert.deepEqual(numbers, { t1: 1, t2: 2, t3: 1, d1: 1, d2: 2 });
    assert.equal(db.prepare("select count(*) as n from project_key").get()?.["n"], 8);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
