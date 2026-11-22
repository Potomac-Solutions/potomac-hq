import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migrate, openDatabase, readMigrations, systemClock } from "../../shared/adapters.ts";
import { sqliteRateLimit } from "./rate-limit.ts";

const migrationsDir = join(import.meta.dirname, "..", "..", "..", "migrations");

test("the database limit holds through a restart, keeps limits apart, and stores no key", () => {
  const dir = mkdtempSync(join(tmpdir(), "hq-rate-limit-"));
  const file = join(dir, "test.db");
  try {
    let db = openDatabase(file);
    migrate(db, readMigrations(migrationsDir), systemClock);
    let now = 1_000_000;
    const make = (name: string) => sqliteRateLimit(db, { name, max: 3, windowMs: 60_000, now: () => now });

    const signIn = make("sign-in");
    assert.deepEqual([signIn("1.2.3.4"), signIn("1.2.3.4"), signIn("1.2.3.4"), signIn("1.2.3.4")], [true, true, true, false]);
    assert.equal(signIn("5.6.7.8"), true, "another key has its own count");
    assert.equal(make("forgot")("1.2.3.4"), true, "another limit has its own count");

    // A restart: a new process, the same file.
    db.close();
    db = openDatabase(file);
    assert.equal(make("sign-in")("1.2.3.4"), false, "still refused after the restart");

    now += 60_000;
    assert.equal(make("sign-in")("1.2.3.4"), true, "a new window starts fresh");

    const stored = JSON.stringify(db.prepare("select * from rate_limit").all());
    assert.ok(!stored.includes("1.2.3.4") && !stored.includes("5.6.7.8"), "only hashes of keys");

    // Old windows are cleared as it goes.
    now += 10 * 60_000;
    make("sign-in")("9.9.9.9");
    assert.equal(db.prepare("select count(*) as n from rate_limit").get()?.["n"], 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
