// v0.5 over real HTTP: the Time page and the timer, a project's money, the
// overview and its exports, and what a member is never sent.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { httpClient, PDF, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let projectId = "";
let taskId = "";
const today = Temporal.Now.plainDateISO("America/New_York").toString();

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  projectId = (await wonProject(t.services, mikey)).project.id;
  taskId = unwrap(projects.addTask(t.services.projects, mikey, projectId as Id, { title: "Draft the menu page", estimate: "2" })).id;
});
after(() => t.stop());

test("the Time page: log time against a project or a task, and see the week", async () => {
  const empty = await admin.page("/time");
  assert.match(empty, /<h1>Time<\/h1>/);
  assert.match(empty, /No timer is running/);
  assert.match(empty, /Nothing logged this week/);
  assert.match(empty, new RegExp(`<option value="${projectId}:${taskId}">Bakery website: Draft the menu page</option>`));

  const logged = await admin.submit("/time", { target: `${projectId}:${taskId}`, on: today, hours: "1.5", note: "First pass", billable: "on" });
  assert.match(logged.html, /Time logged\./);
  assert.match(textOf(logged.html), /1 h 30 min logged, 1 h 30 min of it billable\./);
  assert.match(textOf(logged.html), /Bakery website Draft the menu page 1 h 30 min First pass/);

  assert.match((await admin.submit("/time", { target: projectId, on: today, hours: "", note: "" })).html, /Enter how many hours\./);
  assert.match((await admin.submit("/time", { target: "nonsense", on: today, hours: "1" })).html, /Choose a project or one of its tasks from the list\./);
  const unbilled = await admin.submit("/time", { target: projectId, on: today, hours: "0.5", note: "Admin" });
  assert.match(textOf(unbilled.html), /2 h logged, 1 h 30 min of it billable\./);
  assert.match(unbilled.html, /\(not billable\)/);

  const earlier = await admin.page(`/time?week=${Temporal.PlainDate.from(today).subtract({ days: 7 }).toString()}`);
  assert.match(earlier, /Week of /);
  assert.match(earlier, /Nothing logged this week/);
});

test("the timer follows the board, and can be stopped from the page", async () => {
  await admin.submit(`/tasks/${taskId}/status`, { to: "doing", returnTo: "/board" });
  const time = textOf(await admin.page("/time"));
  assert.match(time, /Working on Draft the menu page · Bakery website , for 0 min\./);
  assert.match(textOf(await admin.page(`/tasks/${taskId}`)), /Time logged 1 h 30 min , and your timer has been running for 0 min/);
  assert.match(textOf(await admin.page("/")), /Hours this week 2 h logged by you , 2 h by everyone \. Your timer is running on Draft the menu page · Bakery website/);

  const stopped = await admin.submit("/timer/stop", { returnTo: `/tasks/${taskId}` });
  assert.match(stopped.location, new RegExp(`^/tasks/${taskId}\\?done=`));
  assert.match(stopped.html, /Timer stopped and the time logged\./);
  assert.match((await admin.submit("/timer/stop", { returnTo: "https://example.com" })).location, /^\/time\?problem=/);
});

test("a project's money: budget, payment, an expense with a receipt, and removing an entry", async () => {
  const page = await admin.page(`/projects/${projectId}/money`);
  assert.match(page, /<h1>Money<\/h1>/);
  assert.match(page, /No expenses yet/);
  assert.match(await admin.page(`/projects/${projectId}`), new RegExp(`<a href="/projects/${projectId}/money">Money</a>`));

  const budget = await admin.submit(`/projects/${projectId}/budget`, { amount: "1,500", hours: "20", rate: "75" });
  assert.match(budget.html, /Budget saved\./);
  assert.match(textOf(budget.html), /Hours 20 h 2 h( \d+ min)? Within/);
  assert.match((await admin.submit(`/projects/${projectId}/budget`, { amount: "lots", hours: "", rate: "75" })).html, /Enter an amount like 1,250\.00\./);

  const paid = await admin.submit(`/projects/${projectId}/payment`, { status: "deposit-paid", invoiceRef: "INV-0007" });
  assert.match(textOf(paid.html), /Deposit paid \. Invoice INV-0007/);

  const expense = await admin.follow(await admin.upload(`/projects/${projectId}/expenses`, { category: "hosting", amount: "12.50", on: today, note: "First month" }, { field: "receipt", name: "receipt.pdf", bytes: PDF }), "expense");
  assert.match(expense.html, /Expense recorded\./);
  assert.match(textOf(expense.html), /Hosting \$12\.50 First month receipt\.pdf/);
  const receipt = /href="\/files\/([0-9a-f-]{36})"/.exec(expense.html)?.[1] ?? "";
  assert.equal((await admin.get(`/files/${receipt}`)).status, 200);
  assert.equal((await httpClient(t.origin).get(`/files/${receipt}`)).status, 404);

  const entryId = /action="\/time\/([0-9a-f-]{36})\/remove"/.exec(expense.html)?.[1] ?? "";
  const removed = await admin.submit(`/time/${entryId}/remove`, { returnTo: `/projects/${projectId}/money` });
  assert.match(removed.location, new RegExp(`^/projects/${projectId}/money\\?done=`));
  assert.match(removed.html, /Entry removed\./);

  const overview = textOf(await admin.page("/money"));
  assert.match(overview, /Bakery website Mt\. Storm Bakery/);
  assert.match(overview, /of \$1,500\.00/);
  assert.match(overview, /Deposit paid/);
});

test("an invoice: drafted from the Money tab, sent, downloaded as a PDF, and paid", async () => {
  const drafted = await admin.submit(`/projects/${projectId}/invoices`, { kind: "deposit", description: "Deposit, one third of the quote", amount: "500", dueOn: "", note: "" });
  assert.match(drafted.location, /^\/invoices\/[0-9a-f-]{36}\?done=/);
  const path = drafted.location.split("?")[0] ?? "";
  assert.match(drafted.html, /<h1>Invoice INV-0001<\/h1>/);
  assert.match(textOf(drafted.html), /Status Draft Billed to Mt\. Storm Bakery/);
  assert.equal((await admin.get(`${path}/pdf`)).status, 404, "a draft has no PDF");

  assert.match((await admin.submit(`${path}/lines`, { description: "Stock photos", amount: "37.50" })).html, /Line added\./);
  const sent = await admin.submit(`${path}/send`, {});
  assert.match(sent.html, /Invoice sent\./);
  assert.match(textOf(sent.html), /Total \$537\.50 Received \$0\.00 Owed \$537\.50/);
  const pdf = await admin.get(`${path}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-disposition"), 'attachment; filename="INV-0001.pdf"');
  assert.equal(new TextDecoder().decode(new Uint8Array(await pdf.arrayBuffer()).slice(0, 5)), "%PDF-");

  assert.match((await admin.submit(`${path}/payments`, { amount: "537.50", method: "card", on: today, reference: "4242 4242 4242 4242" })).html, /That looks like a card number\. HQ never keeps one\./);
  const paid = await admin.submit(`${path}/payments`, { amount: "537.50", method: "check", on: today, reference: "Check 1041" });
  assert.match(paid.html, /Payment recorded\./);
  assert.match(textOf(paid.html), /Status Paid /);
  assert.match(textOf(paid.html), /Check Check 1041 \$537\.50/);
  const money = textOf(await admin.page(`/projects/${projectId}/money`));
  assert.match(money, /Deposit paid/);
  assert.match(money, /INV-0001 Deposit Paid/);
  assert.equal((await httpClient(t.origin).get(`${path}/pdf`)).status, 404);
  assert.equal((await httpClient(t.origin).get(path)).status, 401);
});

test("the exports download as CSV, for those allowed", async () => {
  for (const what of ["time", "expenses", "projects", "invoices", "payments"]) {
    const res = await admin.get(`/exports/${what}.csv`);
    assert.equal(res.status, 200, what);
    assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.match(res.headers.get("content-disposition") ?? "", new RegExp(`^attachment; filename="hq-${what}-\\d{4}-\\d{2}-\\d{2}\\.csv"$`));
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer()).slice(0, 3)], [0xef, 0xbb, 0xbf], "a byte order mark, so Excel reads it as UTF-8");
  }
  assert.equal((await admin.get("/exports/users.csv")).status, 404);
  assert.equal((await admin.get("/exports/time.txt")).status, 404);
  assert.equal((await httpClient(t.origin).get("/exports/time.csv")).status, 404);
});

test("a member logs time, and is sent no cost, budget or export", async () => {
  const member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
  const home = await member.page("/");
  assert.match(home, /Hours this week/);
  assert.doesNotMatch(home, /over-budget|>Money<|>Proposals</);
  assert.match(home, />Time</);
  assert.match((await member.submit("/time", { target: projectId, on: today, hours: "1", note: "" })).html, /Time logged\./);
  assert.doesNotMatch(await member.page("/time"), /Show everyone/);
  assert.doesNotMatch(await member.page(`/projects/${projectId}`), /\/money"/);
  for (const path of ["/money", `/projects/${projectId}/money`]) {
    const res = await member.get(path);
    assert.equal(res.status, 403, path);
    assert.doesNotMatch(await res.text(), /1,500|INV-0007/, path);
  }
  assert.equal((await member.get("/exports/time.csv")).status, 404);
  const refused = await member.post(`/projects/${projectId}/budget`, { amount: "1", hours: "", rate: "" });
  assert.match(new URL(t.origin + (refused.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /You don’t have permission to do that\./);

  for (const path of ["/time", "/money", `/projects/${projectId}/money`]) assert.equal((await httpClient(t.origin).get(path)).status, 401, path);
});
