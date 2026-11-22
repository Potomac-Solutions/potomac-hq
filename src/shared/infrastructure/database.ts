import { DatabaseSync } from "node:sqlite";

export type Database = DatabaseSync;

/**
 * Opens the SQLite file with the settings HQ relies on. Reads are synchronous,
 * which is what the kit's store contract requires (decision 0001).
 */
export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path);
  db.exec("pragma journal_mode = wal");
  db.exec("pragma foreign_keys = on");
  db.exec("pragma busy_timeout = 5000");
  return db;
}

/** Runs fn inside one transaction. If fn throws, nothing is saved. */
export function inTransaction<T>(db: Database, fn: () => T): T {
  db.exec("begin immediate");
  try {
    const value = fn();
    db.exec("commit");
    return value;
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}
