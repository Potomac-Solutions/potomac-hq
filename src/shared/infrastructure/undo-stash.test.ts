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
    assert.deepEqual(stash.take(token, null), { action: "/tasks/1", fields: { title: "Old", description: long } });
    assert.equal(stash.take(token, null), null, "once only");
    assert.equal(stash.take("not a token", null), null);

    // Claimed by the person whose page showed it: only they may use it, and it's in their recent changes.
    const user = (db.prepare("insert into user (id, staff_account, email, name, status, created_at, updated_at) values (?, ?, ?, ?, 'active', ?, ?) returning id").get("u-1", "acct-1", "a@example.com", "A", now, now) as { id: string }).id;
    const first = stash.keep("/opportunities/1/stage", { to: "new" }, "Moved to Consult booked.");
    const second = stash.keep("/opportunities/1/stage", { to: "consult-booked" }, "Moved to Consulted.");
    const other = stash.keep("/tasks/2", { title: "T" }, "Task saved.");
    for (const one of [first, second, other]) stash.claim(one, user);
    assert.equal(stash.claim(other, user), "Task saved.", "claiming again answers the label");
    assert.equal(stash.claim(other, "someone-else"), "", "someone else's isn't offered");
    assert.deepEqual(stash.recent(user).map((change) => change.label), ["Task saved.", "Moved to Consulted."], "one per thing changed, the newest");
    assert.equal(stash.take(other, "someone-else"), null, "only the person who made it");
    assert.ok(stash.take(other, user));

    const later = stash.keep("/tasks/1", { title: "Old" });
    now = "2026-11-26T15:00:01.000Z";
    assert.equal(stash.take(later, null), null, "a day old is too old");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
