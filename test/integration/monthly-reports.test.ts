// Monthly reports to plan clients (decision 0013, slice 5) against a real
// database and over real HTTP: drafted for clients on a plan only, from
// uptime, work done, what's coming and what's waiting; sent only when Send
// is pressed, once, to the primary contact; shown in their portal; skipped;
// and for managers and admins only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import { draftMonthlyReports } from "../../src/client-reports/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { httpClient, PASSWORD, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

const sent: { to: string; subject: string; body: string }[] = [];
let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let plan: { client: { id: Id }; project: { id: Id } };
let month = "";
let monthDay = (day: number) => "";
const query = (res: Response, name: string) => new URL(res.headers.get("location") ?? "", "http://x").searchParams.get(name) ?? "";
const reportsSent = () => sent.filter((one) => one.subject.startsWith("Your month with Potomac Solutions"));
/** With email on, the portal invite is emailed: take its link from there. */
async function portalUser(org: Id, name: string, email: string): Promise<Client> {
  await mikey.post(`/clients/${org}/portal-users`, { name, email });
  const token = /\/portal\/accept\?token=([A-Za-z0-9_-]{43})/.exec(sent.findLast((one) => one.to === email)?.body ?? "")?.[1] ?? "";
  const b = httpClient(t.origin);
  assert.equal((await b.post("/portal/accept", { token, name, password: PASSWORD })).status, 303);
  return b;
}
const reportOf = (org: Id) => t.db.prepare("select id, body, status from monthly_report where organization_id = ?").get(org) as { id: string; body: string; status: string } | undefined;

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, contact: { phone: "240-321-9997", email: "", address: "" }, email: { publicUrl: "https://hq.example", send: async (message) => (sent.push({ to: message.to, subject: message.subject, body: message.body }), { ok: true }) } });
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const today = Temporal.Now.zonedDateTimeISO("America/New_York").toPlainDate();
  month = today.toPlainYearMonth().subtract({ months: 1 }).toString();
  monthDay = (day: number) => `${month}-${String(day).padStart(2, "0")}`;

  plan = await wonProject(t.services, mikeyId, { client: "Moats Hardware", title: "Website plan", pricing: "monthly", amount: "50" });
  unwrap(crm.addContact(t.services.crm, mikeyId, plan.client.id, { name: "Rita Moats", email: "rita@example.com", isPrimary: true }));
  // A site down for 45 minutes last month, a milestone finished and two tasks done; a renewal coming.
  t.db.prepare("insert into monitored_site (id, organization_id, url, active, state, created_at, updated_at) values ('11111111-1111-4111-8111-000000000001', ?, 'https://moats.com/', 1, 'up', 'now', 'now')").run(plan.client.id);
  t.db.prepare("insert into site_outage (site_id, started_at, ended_at, reason) values ('11111111-1111-4111-8111-000000000001', ?, ?, 'HTTP 503')").run(`${monthDay(10)}T15:00:00Z`, `${monthDay(10)}T15:45:00Z`);
  t.db.prepare("insert into milestone (id, project_id, name, due_on, done_on, created_at, updated_at) values ('11111111-1111-4111-8111-000000000002', ?, 'Holiday hours page', ?, ?, 'now', 'now')").run(plan.project.id, monthDay(12), monthDay(12));
  for (const n of [1, 2]) t.db.prepare("insert into task (id, project_id, title, status, priority, done_at, created_at, updated_at) values (?, ?, ?, 'done', 'normal', ?, 'now', 'now')").run(`11111111-1111-4111-8111-00000000001${n}`, plan.project.id, `Internal task ${n}`, `${monthDay(15)}T12:00:00Z`);
  const renewsOn = today.add({ days: 20 }).toString();
  t.db.prepare("insert into renewal (id, organization_id, kind, name, renews_on, term_months, active, cost_minor, price_minor, auto_renews, created_at, updated_at) values ('11111111-1111-4111-8111-000000000003', ?, 'domain', 'moats.com', ?, 12, 1, 1200, 2200, 0, 'now', 'now')").run(plan.client.id, renewsOn);
  // A client without a plan gets no report.
  await wonProject(t.services, mikeyId, { client: "Shrout Feed", title: "One-off site", pricing: "fixed", amount: "900" });
});
after(() => t.stop());

test("last month's reports are drafted for clients on a plan only, from HQ's own records; internal task names stay out", async () => {
  assert.equal(query(await mikey.post("/monthly-reports/draft", {}), "done"), "Drafted 1 report.");
  assert.equal(query(await mikey.post("/monthly-reports/draft", {}), "done"), "Every plan client already has last month’s report.");
  const report = reportOf(plan.client.id);
  assert.ok(report);
  assert.match(report.body, /moats\.com was up 99\.\d\d% of the month \(down 45 minutes in all\)\./);
  assert.match(report.body, /What we did\n- Finished: Holiday hours page\n- 2 tasks done in all/);
  assert.match(report.body, /Coming up\n- moats\.com renews, /);
  assert.doesNotMatch(report.body, /Internal task/);
  assert.equal(t.db.prepare("select count(*) as n from monthly_report").get()?.["n"], 1);
  assert.match(textOf(await mikey.page("/today")), /Send Moats Hardware’s monthly report/);
});

test("Potomac adds a line, sees the email as it will go, and sends it once to the primary contact", async () => {
  const id = reportOf(plan.client.id)?.id ?? "";
  assert.equal(query(await mikey.post(`/monthly-reports/${id}/note`, { note: "Thanks for the photos of the new paint aisle!" }), "done"), "Saved. It’s at the top of the email.");
  const page = textOf(await mikey.page(`/monthly-reports/${id}`));
  assert.match(page, /To: rita@example\.com/);
  assert.match(page, /Hi Rita, Thanks for the photos of the new paint aisle!/);
  assert.equal(query(await mikey.post(`/monthly-reports/${id}/send`, {}), "done"), "Sent to rita@example.com. It’s in their portal too.");
  assert.equal(reportsSent().length, 1);
  assert.equal(reportsSent()[0]?.to, "rita@example.com");
  assert.match(reportsSent()[0]?.body ?? "", /Questions about any of it\? Reply to this email, or call or text 240-321-9997\./);
  assert.equal(query(await mikey.post(`/monthly-reports/${id}/send`, {}), "problem"), "That report has already been sent or skipped.");
  assert.equal(reportsSent().length, 1);
  assert.doesNotMatch(textOf(await mikey.page("/today")), /monthly report/);
});

test("the client reads it in the portal; another client can't", async () => {
  const rita = await portalUser(plan.client.id, "Rita Moats", "rita@example.com");
  const home = textOf(await rita.page("/portal"));
  assert.match(home, /Your monthly reports/);
  const id = reportOf(plan.client.id)?.id ?? "";
  assert.match(textOf(await rita.page(`/portal/reports/${id}`)), /Thanks for the photos of the new paint aisle!.*Holiday hours page/);
  const other = t.db.prepare("select id from client_organization where name = 'Shrout Feed'").get()?.["id"] as Id;
  const wes = await portalUser(other, "Wes Shrout", "wes@example.com");
  assert.equal((await wes.get(`/portal/reports/${id}`)).status, 404);
});

test("a draft can be skipped; members can't see or send reports", async () => {
  t.db.prepare("delete from monthly_report").run();
  assert.equal(draftMonthlyReports(t.services.clientReports) >= 0, true);
  await mikey.post("/monthly-reports/draft", {});
  const id = reportOf(plan.client.id)?.id ?? "";
  assert.equal((await sam.get("/monthly-reports")).status, 403);
  assert.equal(query(await sam.post(`/monthly-reports/${id}/send`, {}), "problem"), "You don’t have permission to do that.");
  assert.equal(query(await mikey.post(`/monthly-reports/${id}/skip`, {}), "done"), "Skipped. Nothing was sent.");
  assert.equal(reportOf(plan.client.id)?.status, "skipped");
  assert.equal(reportsSent().length, 1);
});
