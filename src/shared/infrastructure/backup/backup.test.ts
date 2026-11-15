import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { sqliteActivityLog } from "../activity-log.ts";
import { openDatabase, type Database } from "../database.ts";
import { newId } from "../ids.ts";
import { migrate, readMigrations } from "../migrations.ts";
import { sqliteTransact, systemClock } from "../system.ts";
import { backupConfigFrom } from "./config.ts";
import { BackupFileError, open, seal } from "./envelope.ts";
import { backupName, nextRun, runBackup, type BackupDeps } from "./run-backup.ts";
import { directoryTarget, r2Target, type BackupTarget } from "./targets.ts";

const migrationsDir = join(import.meta.dirname, "..", "..", "..", "..", "migrations");
const keys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: "a long test passphrase" },
});
const privateKey = { key: keys.privateKey, passphrase: "a long test passphrase" };

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hq-backup-test-"));
  db = openDatabase(join(dir, "hq.db"));
  migrate(db, readMigrations(migrationsDir), systemClock);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function deps(target: BackupTarget): BackupDeps {
  return { db, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock: systemClock, newId, target, publicKeyPem: keys.publicKey };
}

function actions(): string[] {
  return (db.prepare("select action from activity_event order by rowid").all() as { action: string }[]).map((r) => r.action);
}

test("a sealed backup opens with the private key and only with it", () => {
  const plain = Buffer.from("the whole database");
  const sealed = seal(plain, keys.publicKey, "2026-11-15T08:17:00.000Z");
  assert.ok(!sealed.includes(plain), "the contents are not readable in the file");
  assert.deepEqual(open(sealed, privateKey), { plain, createdAt: "2026-11-15T08:17:00.000Z" });

  const other = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  assert.throws(() => open(sealed, { key: other.privateKey }), BackupFileError);
  assert.throws(() => open(sealed, { key: keys.privateKey, passphrase: "wrong passphrase!!" }), BackupFileError);
});

test("a changed or cut-off file is refused", () => {
  const sealed = seal(Buffer.from("the whole database"), keys.publicKey, "2026-11-15T08:17:00.000Z");
  const flipped = Buffer.from(sealed);
  flipped[flipped.length - 1] = (flipped[flipped.length - 1] as number) ^ 1;
  assert.throws(() => open(flipped, privateKey), /changed or damaged/);
  assert.throws(() => open(sealed.subarray(0, 20), privateKey), BackupFileError);
  assert.throws(() => open(Buffer.from("SQLite format 3"), privateKey), /Not a Potomac HQ backup/);
});

test("a backup run stores a sealed, complete copy and records it", async () => {
  db.prepare("insert into activity_event (id, occurred_at, action, record_type, record_id) values (?, ?, 'user.signed-in', 'user', ?)").run(newId(), systemClock(), newId());
  const target = directoryTarget(join(dir, "backups"));
  const result = await runBackup(deps(target));

  assert.deepEqual(target.list(), [result.name]);
  assert.match(result.name, /^hq-\d{8}t\d{6}z\.hqbackup$/);
  const restoredPath = join(dir, "restored.db");
  writeFileSync(restoredPath, open(target.get(result.name), privateKey).plain);
  const restored = openDatabase(restoredPath);
  assert.equal(restored.prepare("pragma integrity_check").get()?.["integrity_check"], "ok");
  assert.equal(restored.prepare("select count(*) as n from activity_event").get()?.["n"], 1);
  assert.equal(restored.prepare("select count(*) as n from role").get()?.["n"], 3);
  restored.close();

  assert.deepEqual(actions(), ["user.signed-in", "backup.completed"]);
  const context = JSON.parse(db.prepare("select context from activity_event where action = 'backup.completed'").get()?.["context"] as string);
  assert.deepEqual(context, { file: result.name, bytes: result.bytes });
});

test("a failed upload is recorded as a failure and reported", async () => {
  const broken: BackupTarget = { describe: "nowhere", put: () => Promise.reject(new Error("R2 refused the backup upload: HTTP 403")) };
  await assert.rejects(runBackup(deps(broken)), /HTTP 403/);
  assert.deepEqual(actions(), ["backup.failed"]);
  const context = db.prepare("select context from activity_event").get()?.["context"] as string;
  assert.equal(JSON.parse(context).reason, "R2 refused the backup upload: HTTP 403");
});

test("the R2 target signs a PUT to the bucket, and reports only the status on failure", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const reply = { status: 200 };
  const fakeFetch = (async (url: URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(reply.status === 200 ? "" : "<Error><Code>AccessDenied</Code></Error>", { status: reply.status });
  }) as unknown as typeof fetch;
  const target = r2Target(
    { accountId: "acct123", bucket: "hq-backups", accessKeyId: "AKIDEXAMPLE", secretAccessKey: "very-secret-value", prefix: "test/" },
    { fetch: fakeFetch, now: () => "2026-11-15T08:17:00.000Z" },
  );
  await target.put("hq-20261115t081700z.hqbackup", Buffer.from("sealed"));
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, "https://acct123.r2.cloudflarestorage.com/hq-backups/test/hq-20261115t081700z.hqbackup");
  assert.equal(call.init.method, "PUT");
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers["x-amz-date"], "20261115T081700Z");
  assert.match(headers["authorization"] ?? "", /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261115\/auto\/s3\/aws4_request,SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date,Signature=[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(call).includes("very-secret-value"), "the secret is never sent");

  reply.status = 403;
  await assert.rejects(target.put("hq-x.hqbackup", Buffer.from("sealed")), (error: Error) => error.message === "R2 refused the backup upload: HTTP 403");
  await assert.rejects(target.put("../escape", Buffer.from("x")), /unsafe backup name/);
});

test("backup settings are all or nothing, and never the private key", () => {
  assert.equal(backupConfigFrom({}), null);
  assert.throws(() => backupConfigFrom({ HQ_BACKUP_DIR: "/tmp/x" }), /HQ_BACKUP_PUBLIC_KEY is missing/);
  assert.throws(() => backupConfigFrom({ HQ_BACKUP_PUBLIC_KEY: keys.privateKey, HQ_BACKUP_DIR: "/tmp/x" }), /Never give the server the private key/);
  assert.throws(
    () => backupConfigFrom({ HQ_BACKUP_PUBLIC_KEY: keys.publicKey, HQ_BACKUP_R2_BUCKET: "b", HQ_BACKUP_R2_ACCOUNT_ID: "a" }),
    /Missing: HQ_BACKUP_R2_ACCESS_KEY_ID, HQ_BACKUP_R2_SECRET_ACCESS_KEY/,
  );
  assert.throws(() => backupConfigFrom({ HQ_BACKUP_PUBLIC_KEY: keys.publicKey, HQ_BACKUP_DIR: "/x", HQ_BACKUP_R2_BUCKET: "b" }), /not both/);
  assert.match(backupConfigFrom({ HQ_BACKUP_PUBLIC_KEY: keys.publicKey, HQ_BACKUP_DIR: "/tmp/x" })?.target.describe ?? "", /folder/);
});

test("the nightly run is at 3:17 business time, across a daylight saving change", () => {
  const at = { hour: 3, minute: 17 };
  // 11 p.m. on Saturday Nov 14 in New York: tonight's run is 3:17 a.m. EST.
  assert.equal(nextRun("2026-11-15T04:00:00.000Z", "America/New_York", at), "2026-11-15T08:17:00.000Z");
  // Just after a run: tomorrow.
  assert.equal(nextRun("2026-11-15T08:17:00.000Z", "America/New_York", at), "2026-11-16T08:17:00.000Z");
  // The night clocks spring forward (Mar 8, 2026): still 3:17 a.m. local, now EDT.
  assert.equal(nextRun("2026-03-08T05:00:00.000Z", "America/New_York", at), "2026-03-08T07:17:00.000Z");
  assert.equal(backupName("2026-11-15T08:17:00.123Z"), "hq-20261115t081700z.hqbackup");
});
