import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseId } from "../domain/id.ts";
import { inTransaction, openDatabase } from "./database.ts";
import { newId } from "./ids.ts";

function withDatabase(fn: (db: ReturnType<typeof openDatabase>) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "hq-db-"));
  const db = openDatabase(join(dir, "test.db"));
  try {
    fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("foreign keys are enforced", () => {
  withDatabase((db) => {
    db.exec("create table parent (id integer primary key) strict");
    db.exec("create table child (id integer primary key, parent_id integer not null references parent (id)) strict");
    assert.throws(() => db.exec("insert into child (parent_id) values (99)"), /FOREIGN KEY/i);
  });
});

test("a transaction that throws saves nothing", () => {
  withDatabase((db) => {
    db.exec("create table note (body text not null) strict");
    assert.throws(() =>
      inTransaction(db, () => {
        db.exec("insert into note (body) values ('kept?')");
        throw new Error("stop");
      }),
    );
    assert.equal(db.prepare("select count(*) as n from note").get()?.["n"], 0);
  });
});

test("a transaction that returns saves and passes the value back", () => {
  withDatabase((db) => {
    db.exec("create table note (body text not null) strict");
    const value = inTransaction(db, () => {
      db.exec("insert into note (body) values ('kept')");
      return 7;
    });
    assert.equal(value, 7);
    assert.equal(db.prepare("select count(*) as n from note").get()?.["n"], 1);
  });
});

test("new ids pass the domain's id check and do not repeat", () => {
  const ids = new Set(Array.from({ length: 1000 }, () => newId()));
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.equal(parseId(id).ok, true);
});
