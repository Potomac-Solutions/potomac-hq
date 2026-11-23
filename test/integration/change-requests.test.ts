// Change requests over real HTTP: drafted and sent by Potomac, answered by the
// client in the portal; an approval raises the budget and drafts the invoice.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as finance from "../../src/finance/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, clientSignedIn, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
let rita: Client;
let projectId: Id;
const where = (res: Response) => res.headers.get("location") ?? "";
const problemOf = (res: Response) => new URL(t.origin + where(res)).searchParams.get("problem") ?? "";
const changeId = (title: string) => t.db.prepare("select id from change_request where title = ?").get(title)?.["id"] as string;
const budget = () => ({ ...t.db.prepare("select budget_minor, budget_minutes from project_finance where project_id = ?").get(projectId) });

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  member = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await admin.get("/");
  await member.get("/");
  const me = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const won = await wonProject(t.services, me, { client: "Elk Diner", title: "Diner website" });
  projectId = won.project.id;
  unwrap(finance.setProjectBudget(t.services.finance, me, projectId, { amount: "3000", hours: "40", rate: "50" }));
  rita = await clientSignedIn(t, admin, won.client.id, "Rita Okafor", "rita@example.com");
});
after(() => t.stop());

test("a change is drafted and sent; a member can't", async () => {
  assert.equal(problemOf(await admin.post(`/projects/${projectId}/changes`, { title: "", amount: "400" })), "Say what the change is.");
  assert.match(where(await member.post(`/projects/${projectId}/changes`, { title: "Sneaky", amount: "1" })), /problem=/);
  await admin.post(`/projects/${projectId}/changes`, { title: "Gift cards on the ordering page", description: "Sell and redeem gift cards at checkout.", amount: "400", hours: "8" });
  assert.match(textOf(await admin.page(`/projects/${projectId}/money`)), /Change requests .* Change 1: Gift cards on the ordering page · \$400\.00 · 8 h Sell and redeem gift cards at checkout\. Draft/);
  assert.doesNotMatch(textOf(await rita.page(`/portal/projects/${projectId}`)), /Gift cards/, "a draft is never in the portal");
  await admin.post(`/changes/${changeId("Gift cards on the ordering page")}/send`, {});
  assert.match(textOf(await rita.page("/portal")), /Answer change 1: “Gift cards on the ordering page” Diner website\. Extra work for \$400\.00\. Approve it, or decline it\./);
  assert.match(textOf(await rita.page(`/portal/projects/${projectId}`)), /Changes to the work .* Change 1: Gift cards on the ordering page Sell and redeem gift cards at checkout\. \$400\.00 , about 8 h of work Waiting for your answer/);
});

test("the client approves: the budget grows by the change, and its invoice is drafted", async () => {
  const id = changeId("Gift cards on the ordering page");
  const res = await rita.post(`/portal/changes/${id}/decision`, { decision: "approve", projectId });
  assert.equal(where(res).split("?")[0], `/portal/projects/${projectId}`);
  assert.deepEqual(budget(), { budget_minor: 340000, budget_minutes: 48 * 60 });
  const invoice = t.db.prepare("select status, total_minor from invoice where kind = 'other'").get();
  assert.deepEqual({ ...invoice }, { status: "draft", total_minor: 40000 });
  assert.match(textOf(await admin.page(`/projects/${projectId}/money`)), /Change 1: Gift cards on the ordering page .* Approved by the client in the portal, .* INV-\d{4} drafted/);
  assert.match(textOf(await rita.page(`/portal/projects/${projectId}`)), /of work Approved on \w{3} \d+, 2026/);
  assert.equal(problemOf(await rita.post(`/portal/changes/${id}/decision`, { decision: "decline", projectId })), "That has already been answered.");
  for (const action of ["change-request.drafted", "change-request.sent", "change-request.approved", "project.budget-raised-by-change", "invoice.drafted-from-change"]) assert.ok(actions(t.db).includes(action), action);
});

test("declined, or answered by phone, nothing is charged; a withdrawn one leaves the portal", async () => {
  await admin.post(`/projects/${projectId}/changes`, { title: "A loyalty program", amount: "900" });
  await admin.post(`/changes/${changeId("A loyalty program")}/send`, {});
  await rita.post(`/portal/changes/${changeId("A loyalty program")}/decision`, { decision: "decline", note: "Maybe next year.", projectId });
  assert.deepEqual(budget(), { budget_minor: 340000, budget_minutes: 48 * 60 });
  await admin.post(`/projects/${projectId}/changes`, { title: "Swap the hero photo", amount: "0" });
  await admin.post(`/changes/${changeId("Swap the hero photo")}/send`, {});
  await admin.post(`/changes/${changeId("Swap the hero photo")}/decision`, { decision: "approve", note: "Approved by phone or email." });
  assert.equal(t.db.prepare("select count(*) as n from invoice where kind = 'other'").get()?.["n"], 1, "no invoice for a change at no charge");
  await admin.post(`/projects/${projectId}/changes`, { title: "Never mind", amount: "50" });
  await admin.post(`/changes/${changeId("Never mind")}/send`, {});
  await admin.post(`/changes/${changeId("Never mind")}/withdraw`, {});
  const portal = textOf(await rita.page(`/portal/projects/${projectId}`));
  assert.match(portal, /Change 2: A loyalty program \$900\.00 Declined on .*: “Maybe next year\.”/);
  assert.match(portal, /Change 3: Swap the hero photo No charge/);
  assert.doesNotMatch(portal, /Never mind/);
  assert.match(textOf(await admin.page(`/projects/${projectId}/money`)), /Change 3: Swap the hero photo · No charge Approved by the client, recorded by Mikey Nichols/);
});
