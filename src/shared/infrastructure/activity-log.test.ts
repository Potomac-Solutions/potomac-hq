import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { recordActivity, type ActivityDeps } from "../application/record-activity.ts";
import type { Id } from "../domain/id.ts";
import { sqliteActivityLog } from "./activity-log.ts";
import { openDatabase, type Database } from "./database.ts";
import { newId } from "./ids.ts";
import { migrate, readMigrations } from "./migrations.ts";
import { sqliteTransact, systemClock } from "./system.ts";

const migrationsDir = join(import.meta.dirname, "..", "..", "..", "migrations");

let dir: string;
let db: Database;
let deps: ActivityDeps;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hq-activity-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db, readMigrations(migrationsDir), systemClock);
  deps = { activityLog: sqliteActivityLog(db), clock: systemClock, newId };
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function count(): number {
  return db.prepare("select count(*) as n from activity_event").get()?.["n"] as number;
}

function record(actorId: Id | null = newId()) {
  return recordActivity(deps, {
    actorId,
    action: "opportunity.stage-changed",
    recordType: "opportunity",
    recordId: newId(),
    context: { from: "new", to: "consult-booked" },
  });
}

test("an event is stored exactly as recorded", () => {
  const event = record();
  const row = db.prepare("select * from activity_event where id = ?").get(event.id);
  assert.deepEqual({ ...row }, {
    id: event.id,
    occurred_at: event.occurredAt,
    actor_id: event.actorId,
    action: "opportunity.stage-changed",
    record_type: "opportunity",
    record_id: event.recordId,
    context: '{"from":"new","to":"consult-booked"}',
  });
  // The time is a real UTC instant set by the server.
  assert.equal(Temporal.Instant.from(event.occurredAt).toString(), event.occurredAt);
});

test("an event with no actor is stored with an empty actor", () => {
  const event = record(null);
  assert.equal(db.prepare("select actor_id from activity_event where id = ?").get(event.id)?.["actor_id"], null);
});

test("an event cannot be updated, by any column", () => {
  const event = record();
  for (const sql of [
    "update activity_event set action = 'x.y' where id = ?",
    "update activity_event set context = '{}' where id = ?",
    "update activity_event set occurred_at = '2000-01-01T00:00:00Z' where id = ?",
    "update activity_event set actor_id = null where id = ?",
  ]) {
    assert.throws(() => db.prepare(sql).run(event.id), /append-only/, sql);
  }
  assert.equal(db.prepare("select action from activity_event where id = ?").get(event.id)?.["action"], "opportunity.stage-changed");
});

test("an event cannot be deleted, one at a time or all at once", () => {
  const event = record();
  record();
  assert.throws(() => db.prepare("delete from activity_event where id = ?").run(event.id), /append-only/);
  assert.throws(() => db.exec("delete from activity_event"), /append-only/);
  assert.equal(count(), 2);
});

test("an event cannot be replaced by a second insert with the same id", () => {
  const event = record();
  const sql = `insert or replace into activity_event (id, occurred_at, action, record_type, record_id) values (?, ?, 'x.y', 'x', 'y')`;
  assert.throws(() => db.prepare(sql).run(event.id, event.occurredAt), /append-only/);
  assert.equal(db.prepare("select action from activity_event where id = ?").get(event.id)?.["action"], "opportunity.stage-changed");
});

test("the table itself refuses context that is not a JSON object", () => {
  const insert = db.prepare(
    "insert into activity_event (id, occurred_at, action, record_type, record_id, context) values (?, ?, 'x.y', 'x', 'y', ?)",
  );
  assert.throws(() => insert.run(newId(), systemClock(), "not json"), /CHECK/i);
  assert.throws(() => insert.run(newId(), systemClock(), "[1,2]"), /CHECK/i);
  assert.equal(count(), 0);
});

test("a change and its event are saved together", () => {
  db.exec("create table scratch (note text not null) strict");
  const transact = sqliteTransact(db);
  transact(() => {
    db.exec("insert into scratch (note) values ('changed')");
    record();
  });
  assert.equal(db.prepare("select count(*) as n from scratch").get()?.["n"], 1);
  assert.equal(count(), 1);
});

test("if the event is refused, the change is not saved either", () => {
  db.exec("create table scratch (note text not null) strict");
  const transact = sqliteTransact(db);
  assert.throws(() =>
    transact(() => {
      db.exec("insert into scratch (note) values ('changed')");
      recordActivity(deps, { actorId: null, action: "user.created", recordType: "user", recordId: newId(), context: { password: "x" } });
    }),
  );
  assert.equal(db.prepare("select count(*) as n from scratch").get()?.["n"], 0);
  assert.equal(count(), 0);
});

test("if the change fails after the event was written, the event is not saved either", () => {
  const transact = sqliteTransact(db);
  assert.throws(() =>
    transact(() => {
      record();
      throw new Error("the change failed");
    }),
  );
  assert.equal(count(), 0);
});
