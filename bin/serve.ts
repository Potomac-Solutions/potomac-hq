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
//   HQ_CLIENT_NOTICES  "on" to email clients when something is waiting in the portal; needs email
//   HQ_CONTACT_*       Potomac's phone, email and mailing address, shown to clients in the portal
//   HQ_DOCS_DIR        the documents put into the knowledge base; defaults to ./docs
//   PORT               defaults to 3000
import { createServer } from "node:http";
import { join } from "node:path";
import { contactFrom, createApp } from "../src/app.ts";
import { BUSINESS_TIME_ZONE } from "../src/app.ts";
import { googleSheetTarget, sheetConfigFrom } from "../src/finance/adapters.ts";
import { runRecurringInvoices, sendInvoiceReminders, syncFinanceSheet } from "../src/finance/index.ts";
import { readDocuments } from "../src/knowledge/adapters.ts";
import { seedKnowledge } from "../src/knowledge/index.ts";
import { sendNotices, type Mail } from "../src/portal/index.ts";
import { sendBookingReminders } from "../src/booking/index.ts";
import { calendarConfigFrom, googleBusyCalendar } from "../src/booking/adapters.ts";
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

const contact = contactFrom(process.env);
const clientNoticesSetting = (process.env["HQ_CLIENT_NOTICES"] ?? "").trim().toLowerCase();
if (!["", "on", "off"].includes(clientNoticesSetting)) {
  console.error('HQ_CLIENT_NOTICES must be "on" or "off".');
  process.exit(2);
}
const clientNotices = clientNoticesSetting === "on";
if (clientNotices && !email) {
  console.error("HQ_CLIENT_NOTICES needs email set up: set HQ_BREVO_API_KEY and HQ_EMAIL_FROM.");
  process.exit(2);
}

const db = openDatabase(databasePath);
// Busy times for booked calls, from Google Calendar, if it is set up.
const calendarConfig = calendarConfigFrom(process.env);
const busyCalendar = calendarConfig ? googleBusyCalendar(calendarConfig) : null;
console.log(busyCalendar ? `Booked calls avoid busy times in ${busyCalendar.name}.` : "Booked calls avoid HQ's own calls only: Google Calendar is not set up.");

const app = await createApp({
  db,
  ...(busyCalendar ? { busyCalendar } : {}),
  log,
  secure: process.env["HQ_SECURE"] === "true",
  proxies: Number(process.env["HQ_PROXIES"] ?? 0),
  noticeSecret,
  publicUrl,
  contact,
  clientNotices,
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

// Recurring invoices: every morning at 06:13 business time, and once now in
// case the server was down at that hour. Each period's invoice is made once.
const runRecurring = async () => {
  const result = runRecurringInvoices(createServices(db).finance);
  if (result.made > 0) console.log(`Recurring invoices: made ${result.made}, sent ${result.sent}.`);
};
void runRecurring().catch((error: unknown) => log("Recurring invoices: the run failed", error));
const stopRecurring = scheduleDaily(runRecurring, { zone: BUSINESS_TIME_ZONE, hour: 6, minute: 13, clock: systemClock, log, name: "recurring invoices" });

// Retention: every night at 04:07 business time (docs/retention-policy.md).
const stopRetention = scheduleDaily(
  async () => {
    const removed = applyRetention({ db, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock: systemClock, newId });
    console.log(`Retention: removed ${removed.sessions} expired sessions, ${removed.links} expired links and ${removed.invites} unused invites.`);
  },
  { zone: BUSINESS_TIME_ZONE, hour: 4, minute: 7, clock: systemClock, log, name: "retention run" },
);

// Notices: every minute, email Potomac's people about what clients did, and
// clients about what is waiting for them if that is turned on.
let stopNotices: (() => void) | null = null;
if (email) {
  const noticeDeps = createServices(db).portal;
  const mail: Mail = async (message) => "ok" in (await email.send({ channel: "email", ...message }));
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    sendNotices(noticeDeps, mail, { publicUrl, toClients: clientNotices, phone: contact.phone })
      .then((sent) => {
        if (sent.failed > 0) log(`Notices: ${sent.failed} could not be emailed`);
      })
      .catch((error: unknown) => log("Notices: the run failed", error))
      .finally(() => (busy = false));
  }, 60_000);
  timer.unref();
  stopNotices = () => clearInterval(timer);
  console.log(`Notices: Potomac's people are emailed when a client acts. Clients are ${clientNotices ? "" : "not "}emailed when something is waiting.`);
} else {
  console.log("Notices are off: email is not set up.");
}

// Invoice reminders to clients, when turned on: every morning at 09:07.
const stopInvoiceReminders = email
  ? scheduleDaily(
      async () => {
        const mail = async (message: { to: string; subject: string; body: string }) => "ok" in (await email.send({ channel: "email", ...message }));
        const result = await sendInvoiceReminders(createServices(db).invoiceReminders, mail, { publicUrl, phone: contact.phone, address: contact.address });
        if (result.sent + result.failed + result.skipped > 0) console.log(`Invoice reminders: sent ${result.sent}, failed ${result.failed}, no one to send to ${result.skipped}.`);
      },
      { zone: BUSINESS_TIME_ZONE, hour: 9, minute: 7, clock: systemClock, log, name: "invoice reminders" },
    )
  : null;

// Booked calls: the day-before reminder, checked every ten minutes.
let stopReminders: (() => void) | null = null;
if (email) {
  const bookingDeps = createServices(db).booking;
  const mail = async (message: { to: string; subject: string; body: string }) => "ok" in (await email.send({ channel: "email", ...message }));
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    sendBookingReminders(bookingDeps, mail, { publicUrl, phone: contact.phone })
      .then((sent) => {
        if (sent.failed > 0) log(`Booking reminders: ${sent.failed} could not be emailed`);
      })
      .catch((error: unknown) => log("Booking reminders: the run failed", error))
      .finally(() => (busy = false));
  }, 10 * 60_000);
  timer.unref();
  stopReminders = () => clearInterval(timer);
}

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
    stopRecurring();
    stopInvoiceReminders?.();
    stopNotices?.();
    stopReminders?.();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
