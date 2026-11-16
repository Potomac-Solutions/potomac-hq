// A restore drill: proves a backup can be opened and that HQ runs from it.
// It opens the backup into a temporary folder, checks the copy, starts HQ on
// it, asks for a page, and deletes the copy. Nothing in production changes.
//
// Run it where the private key is: your own computer, never the server.
//   HQ_BACKUP_KEY_PASSPHRASE=... npm run restore:drill -- <backup file> <private key file>
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { BackupFileError, checkRestored, migrate, openBackup, openDatabase, readMigrations, systemClock, type DrillCheck } from "../src/shared/adapters.ts";

const [input, keyFile] = process.argv.slice(2);
if (!input || !keyFile) {
  console.error("Usage: HQ_BACKUP_KEY_PASSPHRASE=<passphrase> npm run restore:drill -- <backup file> <private key file>");
  process.exit(2);
}
const passphrase = process.env["HQ_BACKUP_KEY_PASSPHRASE"];
const dir = mkdtempSync(join(tmpdir(), "hq-drill-"));
const started = Date.now();
const checks: DrillCheck[] = [];
let createdAt = "";
let newestEvent: string | null = null;
let counts: Readonly<Record<string, number>> = {};

try {
  try {
    const opened = openBackup(readFileSync(input), { key: readFileSync(keyFile, "utf8"), ...(passphrase ? { passphrase } : {}) });
    createdAt = opened.createdAt;
    writeFileSync(join(dir, "hq.db"), opened.plain, { mode: 0o600 });
    checks.push({ name: "The backup opens with the private key", ok: true, detail: `Taken ${createdAt}, ${opened.plain.length} bytes.` });
  } catch (error) {
    if (!(error instanceof BackupFileError)) throw error;
    checks.push({ name: "The backup opens with the private key", ok: false, detail: error.message });
  }

  if (checks[0]?.ok) {
    const migrations = readMigrations(join(import.meta.dirname, "..", "migrations"));
    const db = openDatabase(join(dir, "hq.db"));
    try {
      const report = checkRestored(db, migrations);
      checks.push(...report.checks);
      counts = report.counts;
      newestEvent = report.newestEvent;
      if (report.ok) {
        // HQ itself, on the copy: bring the schema up to this code, then serve a page.
        const applied = migrate(db, migrations, systemClock);
        const app = await createApp({ db, secure: false, proxies: 0, noticeSecret: "restore-drill-restore-drill-restore-drill", log: () => {} });
        const server = createServer(app.listener);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        try {
          const health = await fetch(`${origin}/healthz`);
          const page = await fetch(`${origin}/`);
          const body = await page.text();
          const served = health.status === 200 && page.status === 401 && /Sign in/.test(body);
          checks.push({ name: "HQ starts on the copy and serves its sign-in page", ok: served, detail: served ? `Health check 200, sign-in page shown.${applied.length > 0 ? ` ${applied.length} newer migrations applied to the copy first.` : ""}` : `Health check ${health.status}, home page ${page.status}.` });
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    } finally {
      db.close();
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const ok = checks.every((check) => check.ok);
console.log(`Restore drill, ${systemClock()}`);
console.log(`Backup: ${input}${createdAt ? `, taken ${createdAt}` : ""}`);
for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}. ${check.detail}`);
if (Object.keys(counts).length > 0) console.log(`Records: ${Object.entries(counts).map(([table, n]) => `${table} ${n}`).join(", ")}`);
if (newestEvent) console.log(`Newest record in the backup: ${newestEvent}. Anything after that would be lost.`);
console.log(`Took ${((Date.now() - started) / 1000).toFixed(1)} seconds. The copy has been deleted.`);
console.log(ok ? "RESULT: PASS. Write the date and this output in docs/operations.md, \"Restore drills\"." : "RESULT: FAIL. The backup cannot be relied on. Find out why before anything else.");
process.exit(ok ? 0 : 1);
