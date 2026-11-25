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
//   HQ_GITHUB_TOKEN    reads and publishes client sites' content on GitHub; off when unset
//   HQ_ANTHROPIC_API_KEY   the site builder's Claude API key; the builder can't ask Claude when unset
//   HQ_SITE_BUILDER_OWNER  the email of the one person who may change the builder's model and cap
//   HQ_DOCS_DIR        the documents put into the knowledge base; defaults to ./docs
//   HQ_ANTHROPIC_API_KEY  Claude, for the AI drafts of decision 0012; AI is off when unset.
//                      Which features are on, the model and the budget are in Settings → AI.
//   PORT               defaults to 3000
import { createServer } from "node:http";
import { join } from "node:path";
import { contactFrom, createApp } from "../src/app.ts";
import { BUSINESS_TIME_ZONE } from "../src/app.ts";
import { googleSheetTarget, sheetConfigFrom } from "../src/finance/adapters.ts";
import { approveQuietPosts } from "../src/social/index.ts";
import { runRecurringInvoices, sendInvoiceReminders, syncFinanceSheet } from "../src/finance/index.ts";
import { readDocuments } from "../src/knowledge/adapters.ts";
import { seedKnowledge } from "../src/knowledge/index.ts";
import { sendNotices, type Mail } from "../src/portal/index.ts";
import { sendBookingReminders } from "../src/booking/index.ts";
import { sendMorningEmails } from "../src/today/index.ts";
import { emailNotices, fireReminders } from "../src/notices/index.ts";
import { deliverDue } from "../src/webhooks/index.ts";
import { sendDueIssues } from "../src/newsletter/index.ts";
import { draftMonthlyReports } from "../src/client-reports/index.ts";
import { httpsHookSend } from "../src/webhooks/adapters.ts";
import { calendarConfigFrom, googleBusyCalendar } from "../src/booking/adapters.ts";
import { checkSites } from "../src/monitor/index.ts";
import { endForgottenCalls } from "../src/crm/index.ts";
import { httpSiteChecker } from "../src/monitor/adapters.ts";
import { githubConfigFrom, githubPublisher } from "../src/websites/adapters.ts";
import { builderOwnerFrom, claudeApi, claudeConfigFrom } from "../src/builder/adapters.ts";
import { failLostRequests } from "../src/builder/index.ts";
import { githubArchive } from "../src/free-pages/adapters.ts";
import { createServices } from "../src/services.ts";
import { draftWeeklyUpdates, triageNewLeads, checkNewMessages, withDiagnosis } from "../src/ai/index.ts";
import { claudeModel } from "../src/ai/adapters.ts";
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

// The inquiry form: which other sites may post it, and where it is emailed.
const formOrigins = (process.env["HQ_FORM_ORIGINS"] ?? "")
  .split(",")
  .map((one) => one.trim())
  .filter(Boolean)
  .map((one) => {
    try {
      return new URL(one).origin;
    } catch {
      throw new Error(`HQ_FORM_ORIGINS must be site addresses, like https://potomac.solutions. "${one}" is not.`);
    }
  });
const inquiryEmail = process.env["HQ_INQUIRY_EMAIL"] || contact.email || alertTo || "";

// Client sites' content: read from and committed to their repositories on GitHub, if a token is set.
const github = githubConfigFrom(process.env);
console.log(github ? "Client sites' content is published to GitHub." : "Site content can't be set up or published: HQ_GITHUB_TOKEN is not set.");

// The site builder (decision 0010): Claude, if a key is set, and who may change its model and cap.
const claudeConfig = claudeConfigFrom(process.env);
const builderOwner = builderOwnerFrom(process.env);
console.log(claudeConfig ? `The site builder asks Claude.${builderOwner ? "" : " Nobody can change its model or cap: HQ_SITE_BUILDER_OWNER is not set."}` : "The site builder can't ask Claude: HQ_ANTHROPIC_API_KEY is not set.");

// AI drafts (decision 0012) use the same key.
const aiModel = claudeConfig ? claudeModel(claudeConfig.key) : null;
console.log(aiModel ? "AI drafts: Claude is available. Features are turned on in Settings → AI." : "AI drafts are off: HQ_ANTHROPIC_API_KEY is not set.");

const app = await createApp({
  db,
  ai: aiModel,
  claude: claudeConfig ? claudeApi(claudeConfig) : null,
  builderOwner,
  sitePublisher: github ? githubPublisher(github) : null,
  siteArchive: github ? githubArchive(github) : null,
  formOrigins,
  ...(inquiryEmail ? { inquiryEmail } : {}),
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

// Monthly reports to plan clients (decision 0013, section 4): drafted each
// morning at 08:13 in the first week of a month, for the month before, once
// each. Never sent by themselves.
const stopMonthlyReports = scheduleDaily(
  async () => {
    const drafted = draftMonthlyReports(createServices(db).clientReports);
    if (drafted > 0) console.log(`Monthly reports: drafted ${drafted}.`);
  },
  { zone: BUSINESS_TIME_ZONE, hour: 8, minute: 13, clock: systemClock, log, name: "monthly reports" },
);

// The morning email: each person's Today list at 07:03 business time, and
// once now if the server starts after that. Each person gets it once a day.
const sendMorning = async () => {
  if (!email) return;
  const mail = async (message: { to: string; subject: string; body: string }) => "ok" in (await email.send({ channel: "email", ...message }));
  const result = await sendMorningEmails(createServices(db).morning, mail, { publicUrl });
  if (result.sent + result.failed > 0) console.log(`Morning email: sent ${result.sent}, failed ${result.failed}, nothing due for ${result.nothingDue}.`);
};
const stopMorning = email ? scheduleDaily(sendMorning, { zone: BUSINESS_TIME_ZONE, hour: 7, minute: 3, clock: systemClock, log, name: "morning email" }) : null;
if (email && Temporal.Now.zonedDateTimeISO(BUSINESS_TIME_ZONE).hour >= 7) void sendMorning().catch((error: unknown) => log("Morning email: the run failed", error));
console.log(email ? "Morning email: each person's Today list at 7, unless they turned it off." : "The morning email is off: email is not set up.");

// Client websites: checked every five minutes. Changes are emailed to the
// alert address when email and HQ_ALERT_EMAIL are set.
const siteChecker = httpSiteChecker();
// With site-down diagnosis on (decision 0012), AI's likely cause goes in the alert; if AI fails, the alert goes as it was.
const siteAlert = email && alertTo ? async (message: { subject: string; body: string }) => "ok" in (await email.send({ channel: "email", to: alertTo, ...(aiModel ? await withDiagnosis(createServices(db, { aiModel }).ai, message) : message) })) : null;
let checkingSites = false;
const siteTimer = setInterval(() => {
  if (checkingSites) return;
  checkingSites = true;
  checkSites(createServices(db).monitor, siteChecker, siteAlert)
    .catch((error: unknown) => log("Site checks: the run failed", error))
    .finally(() => (checkingSites = false));
}, 5 * 60_000);
siteTimer.unref();

// Site builder requests lost when HQ restarted mid-answer (decision 0010):
// failed and counted at what they reserved, now and every five minutes.
const failLost = () => {
  try {
    const lost = failLostRequests(createServices(db).builder);
    if (lost > 0) console.log(`Site builder: ${lost} lost ${lost === 1 ? "request" : "requests"} marked failed.`);
  } catch (error) {
    log("Site builder: marking lost requests failed", error);
  }
};
failLost();
const lostTimer = setInterval(failLost, 5 * 60_000);
lostTimer.unref();

// Calls nobody ended (decision 0009, section 4): every five minutes, end any
// call open for 3 hours and log it, so call lengths stay honest.
const callTimer = setInterval(() => {
  try {
    const ended = endForgottenCalls(createServices(db).calls);
    if (ended > 0) console.log(`Calls: ended ${ended} left open for 3 hours.`);
  } catch (error) {
    log("Calls: ending forgotten calls failed", error);
  }
}, 5 * 60_000);
callTimer.unref();

// Social media (decision 0011, section 4): every hour, and once now, approve
// posts the client was sent three days ago and didn't answer.
const approveQuiet = () => {
  try {
    const count = approveQuietPosts(createServices(db).social);
    if (count > 0) console.log(`Social media: ${count} approved after 3 days with no answer.`);
  } catch (error) {
    log("Social media: approving quiet posts failed", error);
  }
};
approveQuiet();
const socialTimer = setInterval(approveQuiet, 60 * 60_000);
socialTimer.unref();

// Task reminders and people's notices (decision 0007, section 8): every
// minute, fire the reminders that came due, and email new notices to those
// who asked for them when email is set up. Reminders work without email.
let busyNotices = false;
const taskNoticeTimer = setInterval(() => {
  if (busyNotices) return;
  busyNotices = true;
  (async () => {
    const services = createServices(db, { emailReady: Boolean(email) });
    fireReminders(services.notices);
    if (!email) return;
    const mail = async (message: { to: string; subject: string; body: string }) => "ok" in (await email.send({ channel: "email", ...message }));
    const result = await emailNotices(services.notices, mail, { publicUrl });
    if (result.failed > 0) log(`People's notices: ${result.failed} could not be emailed`);
  })()
    .catch((error: unknown) => log("People's notices: the run failed", error))
    .finally(() => (busyNotices = false));
}, 60_000);
taskNoticeTimer.unref();

// Webhooks (decision 0007, section 12): every minute, send the deliveries
// that are due, signed, and schedule the next try for any that didn't land.
let busyHooks = false;
const webhookTimer = setInterval(() => {
  if (busyHooks) return;
  busyHooks = true;
  deliverDue(createServices(db, { webhookKey: noticeSecret, publicUrl }).webhooks, httpsHookSend)
    .then((sent) => {
      if (sent.failed > 0) log(`Webhooks: ${sent.failed} deliveries didn't land; they'll be tried again`);
    })
    .catch((error: unknown) => log("Webhooks: the run failed", error))
    .finally(() => (busyHooks = false));
}, 60_000);
webhookTimer.unref();

// The newsletter (decision 0013, section 1): every minute, the next batch of
// any issue going out. Each reader is marked as the email goes, so a restart
// never sends twice.
let busyNewsletter = false;
const newsletterTimer = email
  ? setInterval(() => {
      if (busyNewsletter) return;
      busyNewsletter = true;
      const mail = async (message: { to: string; subject: string; body: string; headers?: Readonly<Record<string, string>> }) => "ok" in (await email.send({ channel: "email", ...message }));
      sendDueIssues(createServices(db).newsletter, mail, { publicUrl, address: contact.address })
        .then((sent) => {
          if (sent.sent + sent.failed > 0) console.log(`Newsletter: sent ${sent.sent}, failed ${sent.failed}.`);
          if (sent.failed > 0) log(`Newsletter: ${sent.failed} emails could not be sent`);
        })
        .catch((error: unknown) => log("Newsletter: the run failed", error))
        .finally(() => (busyNewsletter = false));
    }, 60_000)
  : null;
newsletterTimer?.unref();

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

// AI (decision 0012), when it's on: every five minutes, triage new leads and
// check new client messages against what was agreed; on Fridays at 08:13,
// draft each active project's update. Drafts wait for a person.
let aiRunning = false;
const aiTimer = setInterval(() => {
  if (!aiModel || aiRunning) return;
  aiRunning = true;
  const ai = createServices(db, { aiModel }).ai;
  triageNewLeads(ai)
    .then(() => checkNewMessages(ai))
    .catch((error: unknown) => log("AI: the run failed", error))
    .finally(() => (aiRunning = false));
}, 5 * 60_000);
aiTimer.unref();
const stopWeeklyUpdates = aiModel
  ? scheduleDaily(
      async () => {
        if (Temporal.Now.zonedDateTimeISO(BUSINESS_TIME_ZONE).dayOfWeek === 5) await draftWeeklyUpdates(createServices(db, { aiModel }).ai);
      },
      { zone: BUSINESS_TIME_ZONE, hour: 8, minute: 13, clock: systemClock, log, name: "weekly update drafts" },
    )
  : null;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopBackups?.();
    stopSheet?.();
    stopRetention();
    stopRecurring();
    stopMonthlyReports();
    clearInterval(siteTimer);
    clearInterval(callTimer);
    clearInterval(lostTimer);
    clearInterval(socialTimer);
    stopInvoiceReminders?.();
    stopMorning?.();
    stopNotices?.();
    clearInterval(taskNoticeTimer);
    clearInterval(webhookTimer);
    clearInterval(aiTimer);
    stopWeeklyUpdates?.();
    if (newsletterTimer) clearInterval(newsletterTimer);
    stopReminders?.();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
