// Versioned, forward-only migrations. The schema changes no other way.
//
// A migration is a file named NNNN-short-name.sql. Files are applied in number
// order, each in its own transaction, and recorded in schema_migration with a
// checksum. A migration that has been applied is never edited: fix a mistake
// with a new migration.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inTransaction, type Database } from "./database.ts";

export type Migration = { version: number; name: string; sql: string; checksum: string };

export type MigrationProblem =
  | { error: "bad-file-name"; file: string }
  | { error: "duplicate-version"; version: number }
  | { error: "gap-in-versions"; expected: number; found: number }
  | { error: "applied-migration-changed"; version: number; name: string }
  | { error: "applied-migration-missing"; version: number; name: string };

export class MigrationError extends Error {
  readonly problem: MigrationProblem;
  constructor(problem: MigrationProblem) {
    super(`Migration refused: ${JSON.stringify(problem)}`);
    this.name = "MigrationError";
    this.problem = problem;
  }
}

const FILE_NAME = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.sql$/;

/** Reads the migration files in a folder, in order, and checks their numbering. */
export function readMigrations(dir: string): Migration[] {
  const migrations: Migration[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".sql")) continue;
    const match = FILE_NAME.exec(file);
    if (!match) throw new MigrationError({ error: "bad-file-name", file });
    const sql = readFileSync(join(dir, file), "utf8");
    migrations.push({
      version: Number(match[1]),
      name: match[2] as string,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }
  migrations.forEach((migration, index) => {
    const expected = index + 1;
    if (migration.version === migrations[index - 1]?.version) {
      throw new MigrationError({ error: "duplicate-version", version: migration.version });
    }
    if (migration.version !== expected) {
      throw new MigrationError({ error: "gap-in-versions", expected, found: migration.version });
    }
  });
  return migrations;
}

/**
 * Applies every migration that has not been applied yet. Returns the ones it
 * applied. Refuses to run if the files disagree with what the database says
 * was applied.
 */
export function migrate(db: Database, migrations: Migration[], now: () => string): Migration[] {
  db.exec(`
    create table if not exists schema_migration (
      version    integer primary key,
      name       text not null,
      checksum   text not null,
      applied_at text not null
    ) strict
  `);

  const applied = db
    .prepare("select version, name, checksum from schema_migration order by version")
    .all() as { version: number; name: string; checksum: string }[];

  for (const row of applied) {
    const file = migrations.find((migration) => migration.version === row.version);
    if (!file) {
      throw new MigrationError({ error: "applied-migration-missing", version: row.version, name: row.name });
    }
    if (file.checksum !== row.checksum) {
      throw new MigrationError({ error: "applied-migration-changed", version: row.version, name: row.name });
    }
  }

  const pending = migrations.filter((migration) => migration.version > applied.length);
  const record = db.prepare(
    "insert into schema_migration (version, name, checksum, applied_at) values (?, ?, ?, ?)",
  );
  for (const migration of pending) {
    inTransaction(db, () => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, migration.checksum, now());
    });
  }
  return pending;
}
