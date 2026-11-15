import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkStore } from "@potomac-solutions/kit/store";
import { migrate, openDatabase, readMigrations, systemClock } from "../../shared/adapters.ts";
import { sqliteKitStore } from "./kit-store.ts";
import { memoryRateLimit } from "./rate-limit.ts";

const migrationsDir = join(import.meta.dirname, "..", "..", "..", "migrations");

test("the SQLite store keeps the kit's store contract", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hq-kit-store-"));
  const db = openDatabase(join(dir, "test.db"));
  try {
    migrate(db, readMigrations(migrationsDir), systemClock);
    const store = sqliteKitStore(db);
    // The kit's own check: synchronous reads, stored before the promise
    // settles, merging writes, prefix listing in key order, round-tripping.
    await checkStore(store, assert);

    // Collections do not leak into each other, and a null value survives a merge.
    await store.write("one", "k", { a: 1, gone: null });
    await store.write("two", "k", { a: 2 });
    assert.deepEqual(store.get("one", "k"), { a: 1, gone: null });
    assert.deepEqual(store.under("two"), [{ key: "k", a: 2 }]);

    // Survives closing and reopening the file.
    db.close();
    const again = openDatabase(join(dir, "test.db"));
    assert.deepEqual(sqliteKitStore(again).get("one", "k"), { a: 1, gone: null });
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the rate limit allows max hits per key per window, then refuses", () => {
  let now = 0;
  const allow = memoryRateLimit({ max: 3, windowMs: 1000, now: () => now });
  assert.deepEqual([allow("a"), allow("a"), allow("a"), allow("a"), allow("a")], [true, true, true, false, false]);
  assert.equal(allow("b"), true, "another key has its own count");
  now = 1000;
  assert.equal(allow("a"), true, "a new window starts");
});
