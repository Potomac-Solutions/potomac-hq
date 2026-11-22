// v1.0: the Reports page. The pipeline, project health, and budget against
// actual, for admins and managers.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import * as finance from "../../src/finance/index.ts";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const s = t.services;
  const { client, project } = await wonProject(s, mikey, { amount: "1500" });
  unwrap(projects.addMilestone(s.projects, mikey, project.id, { name: "Design signed off", dueOn: "2020-01-01" }));
  unwrap(projects.editProjectDetails(s.projects, mikey, project.id, { name: project.name, health: "at-risk" }));
  unwrap(finance.logTime(s.finance, mikey, { projectId: project.id }, { on: s.today(), hours: "4", note: "Design" }));
  const lost = unwrap(crm.createOpportunity(s.crm, mikey, client.id, { title: "Blog", leadSource: "website", service: "blog" }));
  unwrap(crm.moveOpportunity(s.crm, mikey, lost.id, { to: "lost", lostReason: "No budget" }));
  const open = unwrap(crm.createOpportunity(s.crm, mikey, client.id, { title: "App", leadSource: "website", service: "application" }));
  for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(s.crm, mikey, open.id, { to }));
  unwrap(crm.setOpportunityValue(s.crm, mikey, open.id, { pricing: "fixed", amount: "4000" }));
  unwrap(crm.moveOpportunity(s.crm, mikey, open.id, { to: "quoted" }));
});
after(() => t.stop());

test("the three reports, from real records", async () => {
  const page = textOf(await admin.page("/reports"));
  assert.match(page, /Open now 1 Won 1 Lost 1 Win rate 50% Fixed-price work won \$1,500\.00/);
  assert.match(page, /Quoted 1 \$4,000\.00/);
  assert.match(page, /Word of mouth 1 1 Website 2 0/);
  assert.match(page, /Active projects by health Health Projects On track 0 At risk 1 Off track 0/);
  assert.match(page, /Needs attention Bakery website Mt\. Storm Bakery At risk Next: Design signed off, due Wed, Jan 1, 2020, [\d,]+ days ago/);
  assert.match(page, /Late What Project Was due Milestone: Design signed off Bakery website Wed, Jan 1, 2020, [\d,]+ days ago/);
  assert.match(page, /Bakery website 4 h Not set \$300\.00 Not set All projects \$300\.00/);
  assert.match(await admin.page("/reports?days=30"), /<option value="30" selected/);
  assert.match(await admin.page("/reports?days=7"), /<option value="90" selected/, "a period that is not offered falls back to 90 days");
});

test("a manager opens it, a member does not, and the top bar follows", async () => {
  const manager = await signIn(t, "pat@example.com", "Pat Manager", ["manager"]);
  assert.equal((await manager.get("/reports")).status, 200);
  const member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
  assert.equal((await member.get("/reports")).status, 403);
  assert.doesNotMatch(await member.page("/"), /href="\/reports"/);
  assert.match(await admin.page("/"), /href="\/reports"/);
  assert.match(await member.page("/"), /href="\/knowledge"/);
});
