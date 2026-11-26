import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeText, statusChecks, type StatusFacts } from "./status.ts";

const healthy: StatusFacts = {
  version: "0.18.0",
  startedAt: "2026-11-25T08:00:00Z",
  now: "2026-11-25T20:00:00Z",
  backupsConfigured: true,
  lastBackupAt: "2026-11-25T08:17:00Z",
  lastBackupFailedAt: null,
  emailReady: true,
  email: { sent: 4, failed: 0, lastProblem: "", lastProblemAt: null },
  errors: { count: 0, recent: [] },
  ai: { keySet: true, featuresOn: 3, spent: "$1.20", budget: "$20.00", percent: 6 },
  publicUrl: "https://hq.potomac.solutions",
  contactComplete: true,
  clientNotices: true,
  sitePublisher: true,
  cardPay: "stripe",
  database: { bytes: 3_500_000, migrations: 75, lastMigration: "0075-pins" },
};
const when = (at: string) => at.slice(0, 10);
const states = (facts: StatusFacts) => Object.fromEntries(statusChecks(facts, when).map((one) => [one.key, one.state]));

test("everything working reads as working", () => {
  assert.deepEqual(new Set(Object.values(states(healthy))), new Set(["ok"]));
});

test("no backups, a failed one, or an old one each say so", () => {
  assert.equal(states({ ...healthy, backupsConfigured: false }).backups, "problem");
  assert.equal(states({ ...healthy, lastBackupFailedAt: "2026-11-25T09:00:00Z" }).backups, "problem");
  assert.equal(states({ ...healthy, lastBackupFailedAt: "2026-11-24T09:00:00Z" }).backups, "ok", "a failure before the last success is over");
  assert.equal(states({ ...healthy, lastBackupAt: "2026-11-20T08:00:00Z" }).backups, "warning");
});

test("email failures, errors, the AI budget and missing settings", () => {
  const failing = statusChecks({ ...healthy, email: { sent: 2, failed: 1, lastProblem: "brevo-http-401", lastProblemAt: "2026-11-25T10:00:00Z" } }, when).find((one) => one.key === "email");
  assert.equal(failing?.state, "warning");
  assert.match(failing?.detail ?? "", /brevo-http-401/);
  assert.equal(states({ ...healthy, emailReady: false }).email, "problem");
  assert.equal(states({ ...healthy, errors: { count: 3, recent: [] } }).errors, "warning");
  assert.equal(states({ ...healthy, ai: { ...healthy.ai, percent: 100 } }).ai, "problem");
  const settings = statusChecks({ ...healthy, publicUrl: "", sitePublisher: false }, when).find((one) => one.key === "settings");
  assert.match(settings?.detail ?? "", /HQ_PUBLIC_URL.*GitHub/);
});

test("card payments: which platform, test mode said loudly, and not set up", () => {
  const cards = (cardPay: string) => statusChecks({ ...healthy, cardPay }, when).find((one) => one.key === "cards");
  assert.deepEqual([cards("stripe")?.state, cards("stripe")?.detail], ["ok", "Clients pay invoices by card through Stripe. HQ records each payment by itself."]);
  assert.equal(cards("test")?.state, "warning");
  assert.match(cards("test")?.detail ?? "", /Test mode: clients see Pay by card, and no money moves/);
  assert.equal(cards("")?.state, "warning");
  assert.match(cards("")?.detail ?? "", /Not set up/);
});

test("sizes read in KB or MB", () => {
  assert.equal(sizeText(2048), "2 KB");
  assert.equal(sizeText(3_500_000), "3.3 MB");
});
