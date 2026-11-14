// Scaffold check: the integration runner works against a real SQLite file, and
// the pinned packages load on this Node version (decision 0001, open item 2).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

test("SQLite reads and writes a real file synchronously", () => {
  const dir = mkdtempSync(join(tmpdir(), "hq-"));
  try {
    const db = new DatabaseSync(join(dir, "test.db"));
    db.exec("create table probe (id integer primary key, note text not null)");
    db.prepare("insert into probe (note) values (?)").run("ok");
    const row = db.prepare("select note from probe where id = 1").get();
    assert.equal(row?.["note"], "ok");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Hono loads", async () => {
  const { Hono } = await import("hono");
  const app = new Hono().get("/ping", (c) => c.text("pong"));
  const res = await app.request("/ping");
  assert.equal(await res.text(), "pong");
});

test("@zubra/server loads", async () => {
  const zubra = await import("@zubra/server");
  assert.equal(typeof zubra.createZubra, "function");
});

test("the kit's staff module loads", async () => {
  // The kit ships no type declarations yet. Typed wrappers come with v0.1.
  const specifier = "@potomac-solutions/kit/staff";
  const staff = await import(specifier);
  assert.equal(typeof staff.createStaff, "function");
});
