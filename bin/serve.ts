// Starts Potomac HQ. Run `npm run migrate` first.
//   HQ_DATABASE_PATH   the SQLite file (required)
//   HQ_NOTICE_SECRET   signs one-line messages after redirects (required, 32+ characters)
//   HQ_SECURE          "true" when served over https (production)
//   HQ_PROXIES         trusted proxies in front: 1 on Railway, 0 locally
//   HQ_PUBLIC_URL      the address people use, for printed links
//   HQ_CACHE_DIR       a writable folder for compiled pages, inside the app's
//                      folder so they can import its packages (the container sets it)
//   HQ_BACKUP_*        nightly backups (see .env.example); off when unset
//   HQ_SHEETS_*        the Google Sheet finance records are copied to each night; off when unset
//   HQ_BREVO_API_KEY,  outbound email: reset links, invites, alerts; off when unset
//   HQ_EMAIL_FROM
//   HQ_ALERT_EMAIL     where errors are emailed; needs email set up; off when unset
//   HQ_DOCS_DIR        the documents put into the knowledge base; defaults to ./docs
//   PORT               defaults to 3000
import { createServer } from "node:http";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { BUSINESS_TIME_ZONE } from "../src/app.ts";
import { googleSheetTarget, sheetConfigFrom } from "../src/finance/adapters.ts";
import { syncFinanceSheet } from "../src/finance/index.ts";
import { readDocuments } from "../src/knowledge/adapters.ts";
import { seedKnowledge } from "../src/knowledge/index.ts";
import { createServices } from "../src/services.ts";
import { alertAddressFrom, applyRetention, backupConfigFrom, createMonitor, emailConfigFrom, newId, openDatabase, runBackup, scheduleDaily, sqliteActivityLog, sqliteTransact, systemClock } from "../src/shared/adapters.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name}.`);
    process.exit(2);
  }
  return value;
}

const databasePath = required("HQ_DATABASE_PATH");
const noticeSecret = required("HQ_NOTICE_SECRET");
if (noticeSecret.length < 32) {
  console.error("HQ_NOTICE_SECRET must be at least 32 characters.");
  process.exit(2);
}
const port = Number(process.env["PORT"] ?? 3000);
const publicUrl = (process.env["HQ_PUBLIC_URL"] ?? `http://localhost:${port}`).replace(/\/$/, "");

// Errors go to stderr as JSON, and to the alert address when one is set.
const email = emailConfigFrom(process.env);
const alertTo = alertAddressFrom(process.env);
if (alertTo && !email) {
  console.error("HQ_ALERT_EMAIL needs email set up: set HQ_BREVO_API_KEY and HQ_EMAIL_FROM.");
  process.exit(2);
}
const monitor = createMonitor({ name: publicUrl, clock: systemClock, alert: alertTo && email ? { to: alertTo, send: email.send } : null });
const log = (message: string, error?: unknown) => monitor.report(message, error);

const db = openDatabase(databasePath);
const app = await createApp({
  db,
  log,
  secure: process.env["HQ_SECURE"] === "true",
  proxies: Number(process.env["HQ_PROXIES"] ?? 0),
  noticeSecret,
  publicUrl,
  email,
  ...(process.env["HQ_CACHE_DIR"] ? { cacheDir: process.env["HQ_CACHE_DIR"] } : {}),
});

// Backups: every night at 03:17 business time, if they are set up. A half-set
// configuration stops the start, so a missing backup is never silent.
const backup = backupConfigFrom(process.env);
const stopBackups = backup
  ? scheduleDaily(
      () =>
        runBackup({ db, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock: systemClock, newId, ...backup }).then((result) =>
          console.log(`Backup saved: ${result.name} (${result.bytes} bytes) to ${backup.target.describe}.`),
        ),
      { zone: BUSINESS_TIME_ZONE, hour: 3, minute: 17, clock: systemClock, log },
    )
  : null;
console.log(backup ? `Nightly backups go to ${backup.target.describe}.` : "Backups are not set up. Nothing will be backed up.");

// The finance sheet: every night at 03:47 business time, if it is set up.
const sheet = sheetConfigFrom(process.env);
const sheetTarget = sheet ? googleSheetTarget(sheet) : null;
const stopSheet = sheetTarget
  ? scheduleDaily(() => syncFinanceSheet(createServices(db).finance, sheetTarget).then((result) => console.log(`Finance sheet updated: ${result.rows} rows.`)), {
      zone: BUSINESS_TIME_ZONE,
      hour: 3,
      minute: 47,
      clock: systemClock,
      log,
      name: "finance sheet update",
    })
  : null;
console.log(sheetTarget ? `Finance records are copied each night to ${sheetTarget.describe}.` : "The finance sheet is not set up. Use the CSV exports.");

console.log(alertTo ? `Errors are emailed to ${alertTo}.` : "Error alerts are not set up. Errors are in the log only.");

// Retention: every night at 04:07 business time (docs/retention-policy.md).
const stopRetention = scheduleDaily(
  async () => {
    const removed = applyRetention({ db, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock: systemClock, newId });
    console.log(`Retention: removed ${removed.sessions} expired sessions, ${removed.links} expired links and ${removed.invites} unused invites.`);
  },
  { zone: BUSINESS_TIME_ZONE, hour: 4, minute: 7, clock: systemClock, log, name: "retention run" },
);

// The knowledge base gets HQ's own documents, once each. An article someone
// edited is never overwritten.
try {
  const seeded = seedKnowledge(createServices(db).knowledge, readDocuments(process.env["HQ_DOCS_DIR"] ?? join(import.meta.dirname, "..", "docs")));
  if (seeded.added.length > 0) console.log(`Knowledge base: added ${seeded.added.length} of HQ's documents.`);
  for (const skipped of seeded.skipped) log(`Knowledge base: could not add ${skipped.slug}: ${skipped.error}`);
} catch (error) {
  log("Knowledge base: could not add HQ's documents", error);
}

// A fault nothing caught: log it, alert, and stop. Railway starts HQ again.
for (const event of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(event, (error) => {
    monitor.report(`HQ stopped on an ${event === "uncaughtException" ? "uncaught error" : "unhandled rejection"}`, error);
    void monitor.settled().finally(() => process.exit(1));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}

const server = createServer(app.listener);
server.listen(port, async () => {
  console.log(`Potomac HQ is listening on port ${port}.`);
  const setup = await app.setupPath();
  if (setup) console.log(`Nobody has an account yet. Set up the first admin here (works once, for a day):\n${publicUrl}${setup}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopBackups?.();
    stopSheet?.();
    stopRetention();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
