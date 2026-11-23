// Recurring invoices over real HTTP: set one up on a project, HQ makes each
// period's invoice on its day (a draft, or sent), catches up on missed ones
// once, and a paused one makes nothing.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { runRecurringInvoices } from "../../src/finance/index.ts";
import { createServices } from "../../src/services.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, signIn, testApp, textOf, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
let projectId: Id;
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const runOn = (day: string) => runRecurringInvoices(createServices(t.db, { today: () => day, clock: () => `${day}T12:00:00Z` }).finance);
const invoices = () => t.db.prepare("select number, status, lines, due_on, issued_on, recurring_id from invoice where recurring_id is not null order by number").all() as { number: number; status: string; lines: string; due_on: string | null; issued_on: string | null; recurring_id: string }[];

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
  await member.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  projectId = (await wonProject(t.services, mikey, { client: "Gormania Feed", title: "Feed store website" })).project.id;
});
after(() => t.stop());

test("one is set up on a project's Money page, and shows on Money with what it brings in", async () => {
  assert.equal(problemOf(await admin.post(`/projects/${projectId}/recurring`, { description: "Hosting", amount: "49", every: "week", firstOn: "2027-01-31" })), "Choose how often from the list.");
  assert.equal(problemOf(await member.post(`/projects/${projectId}/recurring`, { description: "Hosting", amount: "49", every: "month", firstOn: "2027-01-31" })), "You don’t have permission to do that.");
  assert.equal(doneOf(await admin.post(`/projects/${projectId}/recurring`, { description: "Website hosting and care", amount: "49", every: "month", firstOn: "2027-01-31", dueDays: "10", autoSend: "1" })), "Recurring invoice set up. HQ makes each one on its day.");
  await admin.post(`/projects/${projectId}/recurring`, { description: "Domain renewal", amount: "24", every: "year", firstOn: "2027-03-01" });
  const money = textOf(await admin.page(`/projects/${projectId}/money`));
  assert.match(money, /Website hosting and care : \$49\.00, every month .* Sent on its day/);
  assert.match(money, /Domain renewal : \$24\.00, every year .* Drafted on its day, for you to send/);
  assert.match(textOf(await admin.page("/money")), /Recurring: \$51\.00 a month, \$612\.00 a year/);
  assert.ok(actions(t.db).includes("recurring-invoice.added"));
});

test("on its day HQ makes the invoice: sent for one, a draft for the other", () => {
  assert.deepEqual(runOn("2027-01-30"), { made: 0, sent: 0 });
  assert.deepEqual(runOn("2027-01-31"), { made: 1, sent: 1 });
  const [first] = invoices();
  assert.equal(first?.status, "sent");
  assert.equal(first?.issued_on, "2027-01-31");
  assert.equal(first?.due_on, "2027-02-10");
  assert.match(first?.lines ?? "", /Website hosting and care, January 2027/);
  assert.deepEqual(runOn("2027-01-31"), { made: 0, sent: 0 }, "never twice for one period");
  assert.deepEqual(runOn("2027-03-01"), { made: 2, sent: 1 }, "February's hosting, and the yearly domain as a draft");
  const all = invoices();
  assert.match(all[1]?.lines ?? "", /February 2027/);
  assert.equal(all[2]?.status, "draft");
  assert.match(all[2]?.lines ?? "", /Domain renewal, Mar 2027 to Feb 2028/);
});

test("missed days are caught up once each; a paused one makes nothing, and starts again without back-billing", async () => {
  assert.deepEqual(runOn("2027-05-31"), { made: 3, sent: 3 }, "March, April and May's hosting");
  const hosting = invoices()[0]?.recurring_id as string;
  assert.match(doneOf(await admin.post(`/recurring/${hosting}/pause`, {})), /^Paused\./);
  assert.deepEqual(runOn("2027-07-31"), { made: 0, sent: 0 });
  assert.match(textOf(await admin.page(`/projects/${projectId}/money`)), /Website hosting and care : \$49\.00, every month Paused/);
  const resumed = await createServices(t.db, { today: () => "2027-09-15", clock: () => "2027-09-15T12:00:00Z" }).finance;
  const { setRecurringActive } = await import("../../src/finance/index.ts");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const back = setRecurringActive(resumed, mikey, hosting as Id, true);
  assert.ok(back.ok);
  assert.equal(back.value.nextOn, "2027-09-30", "from its next day after today; June to August are not billed");
  assert.ok(actions(t.db).includes("recurring-invoice.paused") && actions(t.db).includes("recurring-invoice.resumed"));
});
