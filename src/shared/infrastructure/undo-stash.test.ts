import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "./database.ts";
import { migrate, readMigrations } from "./migrations.ts";
import { systemClock } from "./system.ts";
import { sqliteUndoStash } from "./undo-stash.ts";

test("an undo is kept behind a token that works once, for a day (decision 0014)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hq-undo-"));
  const db = openDatabase(join(dir, "test.db"));
  try {
    migrate(db, readMigrations(join(import.meta.dirname, "..", "..", "..", "migrations")), systemClock);
    let now = "2026-11-25T15:00:00.000Z";
    const stash = sqliteUndoStash(db, () => now);
    const long = "x".repeat(4000);
    const token = stash.keep("/tasks/1", { title: "Old", description: long });
    assert.match(token, /^[0-9a-f]{32}$/);
    assert.deepEqual(stash.take(token), { action: "/tasks/1", fields: { title: "Old", description: long } });
    assert.equal(stash.take(token), null, "once only");
    assert.equal(stash.take("not a token"), null);

    const later = stash.keep("/tasks/1", { title: "Old" });
    now = "2026-11-26T15:00:01.000Z";
    assert.equal(stash.take(later), null, "a day old is too old");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
