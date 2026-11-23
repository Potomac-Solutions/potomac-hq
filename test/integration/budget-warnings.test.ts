// Early budget warnings: a project that has used three quarters of its hours
// ahead of its milestones shows as "Watch" on the dashboard, on Money and on
// its money page, before it is over.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as finance from "../../src/finance/index.ts";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let me: Id;
let projectId: Id;
const day = (days: number) => Temporal.Now.plainDateISO("America/New_York").subtract({ days }).toString();

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  me = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  projectId = (await wonProject(t.services, me, { client: "Elk Diner", title: "Diner website" })).project.id;
  unwrap(finance.setProjectBudget(t.services.finance, me, projectId, { amount: "6000", hours: "40", rate: "50" }));
  const milestones = ["Design", "Menu", "Ordering", "Pickup", "Launch", "Handover"].map((name) => unwrap(projects.addMilestone(t.services.projects, me, projectId, { name })));
  for (const one of milestones.slice(0, 2)) unwrap(projects.setMilestoneDone(t.services.projects, me, one.id, true));
});
after(() => t.stop());

test("half the hours used is fine", async () => {
  for (const days of [1, 2]) unwrap(finance.logTime(t.services.finance, me, { projectId }, { on: day(days), hours: "8" }));
  assert.match(textOf(await admin.page("/")), /Budgets to watch None\./);
});

test("at 80% of hours with 2 of 6 milestones done, it is worth watching", async () => {
  for (const days of [3, 4]) unwrap(finance.logTime(t.services.finance, me, { projectId }, { on: day(days), hours: "8" }));
  assert.match(textOf(await admin.page("/")), /Budgets to watch Diner website · Elk Diner 80% of hours used, 2 of 6 milestones done Watch 32 of 40 hours, \$1,600\.00 of \$6,000\.00/);
  assert.match(textOf(await admin.page("/money")), /Diner website Watch/);
  assert.match(textOf(await admin.page(`/projects/${projectId}/money`)), /Worth watching 80% of hours used, 2 of 6 milestones done\. Three quarters of the budget is used ahead of the work\./);
});

test("past the hours, it is over", async () => {
  for (const days of [5, 6]) unwrap(finance.logTime(t.services.finance, me, { projectId }, { on: day(days), hours: "8" }));
  assert.match(textOf(await admin.page("/")), /Budgets to watch Diner website · Elk Diner 120% of hours used, 2 of 6 milestones done Over/);
});
