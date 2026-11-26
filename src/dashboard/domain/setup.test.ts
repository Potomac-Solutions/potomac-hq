import { test } from "node:test";
import assert from "node:assert/strict";
import { setupChecklist, type SetupFacts } from "./setup.ts";

const fresh: SetupFacts = {
  backupsConfigured: false,
  lastBackupAt: null,
  now: "2026-11-25T20:00:00Z",
  emailReady: false,
  contact: { phone: "", email: "", address: "" },
  twoFactorOn: false,
  aiKeySet: false,
  aiFeaturesOn: 0,
  bookingHours: 0,
  realClients: 0,
  activeUsers: 1,
};

test("a new HQ has everything left to do", () => {
  const setup = setupChecklist(fresh);
  assert.equal(setup.doneCount, 0);
  assert.equal(setup.finished, false);
  assert.equal(setup.mostlyDone, false);
  assert.ok(setup.items.every((item) => item.href.startsWith("/")));
});

test("each line is worked out from the facts, never ticked by hand", () => {
  const setup = setupChecklist({ ...fresh, emailReady: true, contact: { phone: "240-321-9997", email: "a@b.co", address: "" }, bookingHours: 3, realClients: 2, activeUsers: 2 });
  const done = Object.fromEntries(setup.items.map((item) => [item.key, item.done]));
  assert.deepEqual(done, { backups: false, email: true, contact: false, "two-factor": false, hours: true, clients: true, team: true, ai: false });
});

test("backups count only when one finished in the last two days, and say so when set up but not yet run", () => {
  const configured = setupChecklist({ ...fresh, backupsConfigured: true });
  assert.match(configured.items[0]?.why ?? "", /ticks itself/);
  assert.equal(setupChecklist({ ...fresh, lastBackupAt: "2026-11-24T08:17:00Z" }).items[0]?.done, true);
  assert.equal(setupChecklist({ ...fresh, lastBackupAt: "2026-11-20T08:17:00Z" }).items[0]?.done, false);
});

test("AI needs the key and at least one feature on", () => {
  assert.equal(setupChecklist({ ...fresh, aiKeySet: true }).items.at(-1)?.done, false);
  assert.equal(setupChecklist({ ...fresh, aiKeySet: true, aiFeaturesOn: 1 }).items.at(-1)?.done, true);
});

test("three quarters done folds the panel; all done takes it away", () => {
  const most = setupChecklist({ ...fresh, emailReady: true, contact: { phone: "1", email: "a@b.co", address: "x" }, twoFactorOn: true, bookingHours: 1, realClients: 1, activeUsers: 2 });
  assert.equal(most.doneCount, 6);
  assert.equal(most.mostlyDone, true);
  assert.equal(most.finished, false);
  const all = setupChecklist({ ...fresh, lastBackupAt: "2026-11-25T08:17:00Z", emailReady: true, contact: { phone: "1", email: "a@b.co", address: "x" }, twoFactorOn: true, bookingHours: 1, realClients: 1, activeUsers: 2, aiKeySet: true, aiFeaturesOn: 2 });
  assert.equal(all.finished, true);
});
