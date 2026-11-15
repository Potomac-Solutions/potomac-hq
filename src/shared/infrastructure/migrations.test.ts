import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { openDatabase, type Database } from "./database.ts";
import { migrate, MigrationError, readMigrations } from "./migrations.ts";

let dir: string;
let db: Database;
const now = () => "2026-11-14T00:00:00Z";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hq-migrations-"));
  db = openDatabase(join(dir, "test.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, sql: string): void {
  writeFileSync(join(dir, name), sql);
}

function problem(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof MigrationError, String(error));
    return error.problem;
  }
  assert.fail("expected a MigrationError");
}

function tables(): string[] {
  const rows = db
    .prepare("select name from sqlite_schema where type = 'table' and name not like 'sqlite_%' order by name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

test("applies migrations in order and records them", () => {
  file("0001-first.sql", "create table a (id integer primary key) strict;");
  file("0002-second.sql", "create table b (id integer primary key, a_id integer references a (id)) strict;");

  const applied = migrate(db, readMigrations(dir), now);

  assert.deepEqual(applied.map((m) => `${m.version}-${m.name}`), ["1-first", "2-second"]);
  assert.deepEqual(tables(), ["a", "b", "schema_migration"]);
  const rows = db.prepare("select version, name, applied_at from schema_migration order by version").all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { version: 1, name: "first", applied_at: now() },
    { version: 2, name: "second", applied_at: now() },
  ]);
});

test("running again applies nothing", () => {
  file("0001-first.sql", "create table a (id integer primary key) strict;");
  migrate(db, readMigrations(dir), now);
  assert.deepEqual(migrate(db, readMigrations(dir), now), []);
});

test("a later run applies only the new migration", () => {
  file("0001-first.sql", "create table a (id integer primary key) strict;");
  migrate(db, readMigrations(dir), now);
  file("0002-second.sql", "create table b (id integer primary key) strict;");
  const applied = migrate(db, readMigrations(dir), now);
  assert.deepEqual(applied.map((m) => m.version), [2]);
});

test("a failing migration saves nothing, including its own earlier statements", () => {
  file("0001-first.sql", "create table a (id integer primary key) strict;");
  file("0002-broken.sql", "create table b (id integer primary key) strict; create table a (id integer) strict;");

  assert.throws(() => migrate(db, readMigrations(dir), now), /already exists/);

  assert.deepEqual(tables(), ["a", "schema_migration"]);
  assert.equal(db.prepare("select count(*) as n from schema_migration").get()?.["n"], 1);
});

test("refuses when an applied migration was edited", () => {
  file("0001-first.sql", "create table a (id integer primary key) strict;");
  migrate(db, readMigrations(dir), now);
  file("0001-first.sql", "create table a (id integer primary key, extra text) strict;");
  assert.deepEqual(problem(() => migrate(db, readMigrations(dir), now)), {
    error: "applied-migration-changed",
    version: 1,
    name: "first",
  });
});

test("refuses when an applied migration's file is gone", () => {
  file("0001-first.sql", "create table a (id integer primary key) strict;");
  migrate(db, readMigrations(dir), now);
  assert.deepEqual(problem(() => migrate(db, [], now)), {
    error: "applied-migration-missing",
    version: 1,
    name: "first",
  });
});

test("refuses a gap in the numbering", () => {
  file("0001-first.sql", "select 1;");
  file("0003-third.sql", "select 1;");
  assert.deepEqual(problem(() => readMigrations(dir)), { error: "gap-in-versions", expected: 2, found: 3 });
});

test("refuses two files with the same number", () => {
  file("0001-first.sql", "select 1;");
  file("0001-other.sql", "select 1;");
  assert.deepEqual(problem(() => readMigrations(dir)), { error: "duplicate-version", version: 1 });
});

test("refuses a badly named file", () => {
  file("1-first.sql", "select 1;");
  assert.deepEqual(problem(() => readMigrations(dir)), { error: "bad-file-name", file: "1-first.sql" });
});

test("ignores files that are not SQL", () => {
  file("README.md", "notes");
  file("0001-first.sql", "select 1;");
  assert.equal(readMigrations(dir).length, 1);
});
