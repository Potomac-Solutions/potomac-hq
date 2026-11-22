// v1.0's commands, as Mikey will run them: the restore drill, the full
// export and the retention run, each against a real database with records.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as projects from "../../src/projects/index.ts";
import { createServices } from "../../src/services.ts";
import { applyRetention, checkRestored, migrate, newId, openDatabase, readMigrations, sqliteActivityLog, sqliteTransact, systemClock } from "../../src/shared/adapters.ts";
import { addUser, events, PDF, unwrap, wonProject } from "../support/harness.ts";

const root = join(import.meta.dirname, "..", "..");
const PASSPHRASE = "a long test passphrase";
const migrations = readMigrations(join(root, "migrations"));

function run(script: string, args: string[], env: Record<string, string>): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [join(root, "bin", script), ...args], { env: { PATH: process.env["PATH"] ?? "", ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, output };
  } catch (error) {
    const failed = error as { status: number; stderr: string; stdout: string };
    return { status: failed.status, output: failed.stdout + failed.stderr };
  }
}

/** A database file with a user, a client, a project and a stored file. */
async function database(dir: string): Promise<string> {
  const path = join(dir, "hq.db");
  const db = openDatabase(path);
  migrate(db, migrations, systemClock);
  const services = createServices(db);
  const mikey = addUser(db, "admin", "Mikey Nichols");
  const { project } = await wonProject(services, mikey);
  unwrap(projects.addDeliverable(services.projects, mikey, project.id, { title: "Design", file: { name: "home page/design v1.pdf", bytes: PDF } }));
  db.close();
  return path;
}

test("the restore drill passes on a good backup and fails on a bad one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hq-drill-cli-"));
  try {
    const db = await database(dir);
    const key = join(dir, "hq-backup");
    assert.equal(run("backup-keygen.ts", [key], { HQ_BACKUP_KEY_PASSPHRASE: PASSPHRASE }).status, 0);
    const backups = join(dir, "backups");
    assert.equal(run("backup.ts", [], { HQ_DATABASE_PATH: db, HQ_BACKUP_PUBLIC_KEY_FILE: `${key}.public.pem`, HQ_BACKUP_DIR: backups }).status, 0);
    const file = join(backups, readdirSync(backups)[0] as string);

    const drill = run("restore-drill.ts", [file, `${key}.private.pem`], { HQ_BACKUP_KEY_PASSPHRASE: PASSPHRASE });
    assert.equal(drill.status, 0, drill.output);
    for (const line of [/PASS {2}The backup opens with the private key/, /PASS {2}The file is whole/, /PASS {2}Every record's links hold/, new RegExp(`PASS {2}The schema matches this code\\. All ${migrations.length} migrations are applied`), /PASS {2}It holds records\. 1 users/, /PASS {2}Every file has its contents/, /PASS {2}HQ starts on the copy and serves its sign-in page/, /Records: user 1, client_organization 1, .*file 1/, /Newest record in the backup: 20\d\d-/, /RESULT: PASS/]) {
      assert.match(drill.output, line);
    }
    assert.deepEqual(readdirSync(tmpdir()).filter((name) => name.startsWith("hq-drill-") && !name.startsWith("hq-drill-cli-")), [], "the copy is deleted");

    const wrong = run("restore-drill.ts", [file, `${key}.private.pem`], { HQ_BACKUP_KEY_PASSPHRASE: "not it" });
    assert.equal(wrong.status, 1);
    assert.match(wrong.output, /FAIL {2}The backup opens with the private key[\s\S]*RESULT: FAIL/);

    const cut = join(dir, "cut.hqbackup");
    writeFileSync(cut, readFileSync(file).subarray(0, 400));
    assert.equal(run("restore-drill.ts", [cut, `${key}.private.pem`], { HQ_BACKUP_KEY_PASSPHRASE: PASSPHRASE }).status, 1);
    assert.equal(run("restore-drill.ts", [], {}).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the drill's checks catch a copy that is missing a file's contents or is from other code", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hq-drill-checks-"));
  try {
    const db = openDatabase(await database(dir));
    assert.equal(checkRestored(db, migrations).ok, true);
    assert.equal(checkRestored(db, migrations.slice(0, -1)).checks.find((check) => check.name === "The schema matches this code")?.detail, "The copy is from newer code than this.");
    const edited = migrations.map((one, n) => (n === 0 ? { ...one, checksum: "0".repeat(64) } : one));
    assert.match(checkRestored(db, edited).checks.find((check) => !check.ok)?.detail ?? "", /Migration 1 in the copy is not the one in this code/);
    db.exec("pragma foreign_keys = off; delete from file_blob; pragma foreign_keys = on;");
    const report = checkRestored(db, migrations);
    assert.equal(report.ok, false);
    assert.equal(report.checks.find((check) => !check.ok)?.detail, "1 files have no contents.");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the export writes every table and file, and leaves sign-in secrets out", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hq-export-cli-"));
  try {
    const path = await database(dir);
    const out = join(dir, "export");
    const made = run("export.ts", [out], { HQ_DATABASE_PATH: path });
    assert.equal(made.status, 0, made.output);
    assert.match(made.output, /Exported \d+ rows from \d+ tables and 1 files/);
    const written = readdirSync(out);
    for (const name of ["manifest.json", "user.json", "client_organization.json", "project.json", "activity_event.json", "article.json", "schema_migration.json", "files"]) assert.ok(written.includes(name), name);
    assert.ok(!written.includes("kit_document.json") && !written.includes("file_blob.json"));
    for (const table of ["user_two_factor", "two_factor_recovery", "two_factor_session"]) assert.ok(!written.includes(`${table}.json`), table);
    const clients = JSON.parse(readFileSync(join(out, "client_organization.json"), "utf8")) as { name: string }[];
    assert.deepEqual(clients.map((client) => client.name), ["Mt. Storm Bakery"]);
    const [stored] = readdirSync(join(out, "files"));
    assert.match(stored ?? "", /^[0-9a-f-]{36}-design_v1\.pdf$/);
    assert.deepEqual(new Uint8Array(readFileSync(join(out, "files", stored as string))), PDF);
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as { files: number; tables: { name: string }[] };
    assert.equal(manifest.files, 1);
    assert.equal(run("export.ts", [out], { HQ_DATABASE_PATH: path }).status, 1, "never writes into a folder that has files");
    const db = openDatabase(path);
    assert.deepEqual(events(db).filter((e) => e.action === "data.exported").map((e) => [e.actor, e.context["by"], e.context["files"]]), [[null, "server-command", 1]]);
    db.close();
    assert.ok(existsSync(join(out, "manifest.json")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retention removes expired sessions, used-up links and stale invites, and nothing else", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hq-retention-"));
  try {
    const path = await database(dir);
    const db = openDatabase(path);
    const admin = db.prepare("select id from user").get()?.["id"] as string;
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const kit = db.prepare("insert into kit_document (collection, key, fields) values (?, ?, ?)");
    kit.run("staff-sessions", "old", JSON.stringify({ account: "a1", until: now - 40 * day, ended: true }));
    kit.run("staff-sessions", "recent", JSON.stringify({ account: "a1", until: now - 5 * day, ended: true }));
    kit.run("staff-sessions", "live", JSON.stringify({ account: "a1", until: now + 5 * day, ended: false }));
    kit.run("portal:staff-sessions", "old", JSON.stringify({ account: "p1", until: now - 31 * day }));
    kit.run("staff-tokens", "old", JSON.stringify({ kind: "reset", until: now - 60 * day, used: true }));
    kit.run("portal:staff-tokens", "live", JSON.stringify({ kind: "invite", until: now + 2 * day, used: false }));
    kit.run("accounts", "a1", JSON.stringify({ email: "mikey@example.com", until: 0 }));
    const invite = db.prepare("insert into user_invite (id, email, name, roles, invited_by, created_at) values (?, ?, 'Someone', '[\"member\"]', ?, ?)");
    invite.run(newId(), "old@example.com", admin, new Date(now - 45 * day).toISOString());
    invite.run(newId(), "new@example.com", admin, new Date(now - 2 * day).toISOString());
    const eventsBefore = events(db).length;

    const deps = { db, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock: systemClock, newId };
    assert.deepEqual(applyRetention(deps), { sessions: 2, links: 1, invites: 1 });
    assert.deepEqual((db.prepare("select collection, key from kit_document order by collection, key").all() as { collection: string; key: string }[]).map((row) => `${row.collection}/${row.key}`), ["accounts/a1", "portal:staff-tokens/live", "staff-sessions/live", "staff-sessions/recent"]);
    assert.deepEqual((db.prepare("select email from user_invite").all() as { email: string }[]).map((row) => row.email), ["new@example.com"]);
    assert.deepEqual(events(db).slice(eventsBefore).map((e) => [e.action, e.actor, e.context]), [["retention.applied", null, { expiredSignIns: 2, expiredLinks: 1, staleInvites: 1 }]]);

    // A second run finds nothing and writes no event. The command says so.
    assert.deepEqual(applyRetention(deps), { sessions: 0, links: 0, invites: 0 });
    assert.equal(events(db).length, eventsBefore + 1);
    assert.throws(() => db.prepare("delete from activity_event").run(), /append-only/, "the audit log cannot be thinned");
    db.close();
    const ran = run("retention.ts", [], { HQ_DATABASE_PATH: path });
    assert.equal(ran.status, 0, ran.output);
    assert.match(ran.output, /Removed 0 expired sessions, 0 expired links and 0 unused invites\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
