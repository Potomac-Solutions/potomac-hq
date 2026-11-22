// v0.5's services against a real database: time and the timer, expenses,
// budget against actual, payment status, exports, and who may see what.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import * as finance from "../../src/finance/index.ts";
import * as projects from "../../src/projects/index.ts";
import * as proposals from "../../src/proposals/index.ts";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, addUser, count, events, PDF, testDb, unwrap, wonProject, type TestDb } from "../support/harness.ts";

let t: TestDb;
let mikey: Id;
let now = "2026-11-16T15:00:00.000Z";
const TODAY = "2026-11-16";

beforeEach(() => {
  now = "2026-11-16T15:00:00.000Z";
  t = testDb({ clock: () => now, today: () => TODAY });
  mikey = addUser(t.db, "admin", "Mikey Nichols");
});
afterEach(() => t.close());

/** A project made by accepting the application template: $2,400 and 32 hours. */
/**
 * A project from an accepted proposal. It leaves out the deposit invoice HQ
 * drafts on acceptance, so these tests number their own invoices. The draft
 * has its own test below.
 */
function acceptedProject() {
  const client = unwrap(crm.createClient(t.services.crm, mikey, { name: "Mt. Storm Bakery" }));
  const opportunity = unwrap(crm.createOpportunity(t.services.crm, mikey, client.id, { title: "Bakery ordering app", leadSource: "phone", service: "application" }));
  for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(t.services.crm, mikey, opportunity.id, { to }));
  const draft = unwrap(proposals.startProposal(t.services.proposals, mikey, opportunity.id, {}));
  unwrap(proposals.sendProposalVersion(t.services.proposals, mikey, draft.id));
  const answer = unwrap(proposals.recordProposalDecision({ ...t.services.proposals, onAccepted: () => {} }, mikey, draft.id, { decision: "accepted", byName: "Ann Baker", on: TODAY, method: "email" }));
  assert.ok(answer.project);
  return answer.project;
}

test("marking a task “working on” starts the timer, and moving it on stops it and logs the time", async () => {
  const deps = t.services.finance;
  const { project } = await wonProject(t.services, mikey);
  const menu = unwrap(projects.addTask(t.services.projects, mikey, project.id, { title: "Draft the menu page" }));
  const hosting = unwrap(projects.addTask(t.services.projects, mikey, project.id, { title: "Set up hosting" }));

  assert.equal(finance.runningTimer(deps, mikey).running, false);
  unwrap(projects.moveTaskStatus(t.services.projects, mikey, menu.id, "doing"));
  let timer = finance.runningTimer(deps, mikey);
  assert.deepEqual({ running: timer.running, label: timer.label, task: timer.taskId }, { running: true, label: "Draft the menu page · Bakery website", task: menu.id });

  // Forty minutes later, start on something else: the first timer stops by itself.
  now = "2026-11-16T15:40:00.000Z";
  assert.equal(finance.runningTimer(deps, mikey).since, "40 min");
  unwrap(projects.moveTaskStatus(t.services.projects, mikey, hosting.id, "doing"));
  timer = finance.runningTimer(deps, mikey);
  assert.equal(timer.taskId, hosting.id);
  assert.equal(finance.taskTime(deps, mikey, menu.id).logged, "40 min");
  assert.equal(count(t.db, "time_entry"), 2, "one finished, one running");

  // An hour and a half on, the task is done.
  now = "2026-11-16T17:10:00.000Z";
  assert.deepEqual({ ...finance.taskTime(deps, mikey, hosting.id) }, { can: true, logged: "0 h", running: true, since: "1 h 30 min" });
  unwrap(projects.moveTaskStatus(t.services.projects, mikey, hosting.id, "done"));
  assert.equal(finance.runningTimer(deps, mikey).running, false);
  assert.equal(finance.taskTime(deps, mikey, hosting.id).logged, "1 h 30 min");

  // Stopping by hand, and stopping when nothing runs.
  unwrap(projects.moveTaskStatus(t.services.projects, mikey, menu.id, "todo"));
  unwrap(projects.moveTaskStatus(t.services.projects, mikey, menu.id, "doing"));
  now = "2026-11-16T17:25:00.000Z";
  assert.equal(unwrap(finance.stopTimer(deps, mikey)).minutes, 15);
  assert.deepEqual(finance.stopTimer(deps, mikey), { ok: false, error: "not-running" });

  const sheet = unwrap(finance.timeSheet(deps, mikey));
  assert.equal(sheet.total, "2 h 25 min");
  assert.deepEqual(sheet.entries.map((e) => [e.taskTitle, e.hours]), [["Draft the menu page", "15 min"], ["Set up hosting", "1 h 30 min"], ["Draft the menu page", "40 min"]]);
  const timed = actions(t.db).filter((a) => a.startsWith("time."));
  assert.deepEqual(timed, ["time.started", "time.stopped", "time.started", "time.stopped", "time.started", "time.stopped"]);
  assert.ok(unwrap(projects.projectOverview(t.services.projects, mikey, project.id)).history.some((h) => h.text === "Mikey Nichols started working"));
});

test("someone else moving your task out of “working on” stops your timer; a person with no time permission gets none", async () => {
  const { project } = await wonProject(t.services, mikey);
  const sam = addUser(t.db, "member", "Sam Helper");
  const task = unwrap(projects.addTask(t.services.projects, mikey, project.id, { title: "Draft" }));
  unwrap(projects.moveTaskStatus(t.services.projects, sam, task.id, "doing"));
  assert.equal(finance.runningTimer(t.services.finance, sam).running, true);
  now = "2026-11-16T15:30:00.000Z";
  unwrap(projects.moveTaskStatus(t.services.projects, mikey, task.id, "blocked"));
  assert.equal(finance.runningTimer(t.services.finance, sam).running, false);
  assert.equal(finance.taskTime(t.services.finance, sam, task.id).logged, "30 min");

  // A role that may edit tasks but not log time: the move works, no timer starts.
  t.db.prepare("delete from role_permission where permission = 'time.log' and role_id = (select id from role where key = 'member')").run();
  unwrap(projects.moveTaskStatus(t.services.projects, sam, task.id, "doing"));
  assert.equal(count(t.db, "time_entry"), 1);
  assert.deepEqual(finance.runningTimer(t.services.finance, sam), { running: false, label: "", taskId: "", since: "", can: false });
});

test("time typed in afterwards, by week, mine or everyone's", async () => {
  const deps = t.services.finance;
  const { project } = await wonProject(t.services, mikey);
  const other = await wonProject(t.services, mikey, { client: "Gormania Feed", title: "Feed store site" });
  const task = unwrap(projects.addTask(t.services.projects, mikey, project.id, { title: "Draft" }));
  const foreign = unwrap(projects.addTask(t.services.projects, mikey, other.project.id, { title: "Other" }));
  const sam = addUser(t.db, "member", "Sam Helper");

  unwrap(finance.logTime(deps, mikey, { projectId: project.id, taskId: task.id }, { on: TODAY, hours: "2", note: "Menu" }));
  unwrap(finance.logTime(deps, mikey, { projectId: project.id }, { on: "2026-11-10", hours: "1", billable: false }));
  const sams = unwrap(finance.logTime(deps, sam, { projectId: project.id }, { on: TODAY, hours: "0.5" }));
  assert.deepEqual(finance.logTime(deps, mikey, { projectId: project.id, taskId: foreign.id }, { on: TODAY, hours: "1" }), { ok: false, error: "task-not-in-project" });
  assert.deepEqual(finance.logTime(deps, mikey, { projectId: project.id }, { on: "2026-11-17", hours: "1" }), { ok: false, error: "date-in-future" });

  const mine = unwrap(finance.timeSheet(deps, mikey));
  assert.deepEqual({ total: mine.total, week: mine.week.from, previous: mine.week.previous, entries: mine.entries.length }, { total: "2 h", week: "2026-11-16", previous: "2026-11-09", entries: 1 });
  assert.ok(mine.targets.some((target) => target.value === `${project.id}:${task.id}` && target.label === "Bakery website: Draft"));
  const last = unwrap(finance.timeSheet(deps, mikey, { week: "2026-11-10" }));
  assert.deepEqual([last.total, last.billable, last.week.isThisWeek], ["1 h", "0 h", false]);
  assert.equal(unwrap(finance.timeSheet(deps, mikey, { everyone: true })).total, "2 h 30 min");
  const samsSheet = unwrap(finance.timeSheet(deps, sam, { everyone: true }));
  assert.deepEqual([samsSheet.total, samsSheet.everyone, samsSheet.canSeeEveryone], ["30 min", false, false], "a member sees only their own");
  assert.equal(unwrap(finance.timeSheet(deps, mikey, { week: "not-a-date" })).week.from, "2026-11-16");
  assert.deepEqual(unwrap(finance.hoursThisWeek(deps, mikey)), { mine: "2 h", everyone: "2 h 30 min", showEveryone: true, timer: { running: false, label: "", taskId: "", since: "", can: true } });

  // Removing: your own, or anyone's if you may see everyone's. Otherwise it is not there.
  assert.deepEqual(finance.removeTime(deps, sam, mine.entries[0]?.id as Id), { ok: false, error: "not-found" });
  unwrap(finance.removeTime(deps, mikey, sams.id));
  assert.equal(unwrap(finance.timeSheet(deps, mikey, { everyone: true })).total, "2 h");
  assert.equal(count(t.db, "time_entry"), 3, "a removed entry stays as a record");
  assert.deepEqual(finance.removeTime(deps, mikey, sams.id), { ok: false, error: "not-found" });
});

test("estimate against actual, from the accepted proposal's budget, by phase, with margin", () => {
  const deps = t.services.finance;
  const project = acceptedProject();
  const design = unwrap(projects.addPhase(t.services.projects, mikey, project.id, { name: "Design" }));
  const build = unwrap(projects.addPhase(t.services.projects, mikey, project.id, { name: "Build" }));
  const sketch = unwrap(projects.addTask(t.services.projects, mikey, project.id, { title: "Sketch", phaseId: design.id, estimate: "2" }));
  unwrap(projects.addTask(t.services.projects, mikey, project.id, { title: "Pages", phaseId: build.id, estimate: "20" }));
  unwrap(finance.logTime(deps, mikey, { projectId: project.id, taskId: sketch.id }, { on: TODAY, hours: "3" }));
  unwrap(finance.logTime(deps, mikey, { projectId: project.id }, { on: TODAY, hours: "1", billable: false }));
  unwrap(finance.addExpense(deps, mikey, project.id, { category: "hosting", amount: "100", on: TODAY, note: "First year" }));

  let money = unwrap(finance.projectMoney(deps, mikey, project.id));
  assert.equal(money.fromProposal, true);
  assert.equal(money.period, "so far");
  assert.deepEqual(money.summary, {
    hours: { budget: "32 h", actual: "4 h", over: false },
    cost: { budget: "$2,400.00", actual: "$400.00", over: false },
    billableHours: "3 h",
    timeCost: "$300.00",
    expenses: "$100.00",
    margin: "$2,000.00",
    marginPercent: "83%",
    marginNegative: false,
    over: false,
  });
  assert.deepEqual(money.phases.map((p) => [p.name, p.estimate, p.actual, p.over]), [["Design", "2 h", "3 h", true], ["Build", "20 h", "0 h", false], ["No phase", "", "1 h", false]]);
  assert.deepEqual(unwrap(finance.projectsOverBudget(deps, mikey)).items, []);

  // By hand: a tighter budget and a different rate.
  unwrap(finance.setProjectBudget(deps, mikey, project.id, { amount: "350", hours: "3", rate: "80" }));
  money = unwrap(finance.projectMoney(deps, mikey, project.id));
  assert.equal(money.fromProposal, false);
  assert.deepEqual([money.summary.hours.over, money.summary.cost.actual, money.summary.cost.over, money.summary.margin, money.summary.marginNegative], [true, "$420.00", true, "-$70.00", true]);
  assert.deepEqual(unwrap(finance.projectsOverBudget(deps, mikey)).items.map((i) => [i.name, i.why]), [["Bakery ordering app", "4 of 3 hours, $420.00 of $350.00 so far"]]);

  // Payment.
  unwrap(finance.setProjectPayment(deps, mikey, project.id, { status: "deposit-paid", invoiceRef: "INV-0007" }));
  assert.deepEqual(unwrap(finance.projectMoney(deps, mikey, project.id)).payment, { status: "deposit-paid", statusLabel: "Deposit paid", invoiceRef: "INV-0007" });
  assert.deepEqual(finance.setProjectPayment(deps, mikey, project.id, { status: "late" }), { ok: false, error: "invalid-payment-status" });

  const overview = unwrap(finance.financeOverview(deps, mikey));
  assert.deepEqual(overview.rows.map((r) => [r.name, r.hours.actual, r.cost.actual, r.margin, r.paymentLabel, r.over]), [["Bakery ordering app", "4 h", "$420.00", "-$70.00", "Deposit paid", true]]);
  assert.deepEqual(overview.totals, { budget: "$350.00", cost: "$420.00", margin: "-$70.00" });

  const wanted = ["expense.added", "project.budget-set", "project.payment-status-changed"];
  assert.deepEqual(actions(t.db).filter((a) => wanted.includes(a)), wanted);
});

test("a monthly plan is measured over this month only", async () => {
  const deps = t.services.finance;
  const { project } = await wonProject(t.services, mikey, { pricing: "monthly", amount: "50" });
  unwrap(finance.setProjectBudget(deps, mikey, project.id, { amount: "50", hours: "1", rate: "" }));
  unwrap(finance.logTime(deps, mikey, { projectId: project.id }, { on: "2026-10-20", hours: "5" }));
  unwrap(finance.logTime(deps, mikey, { projectId: project.id }, { on: "2026-11-03", hours: "0.5" }));
  const money = unwrap(finance.projectMoney(deps, mikey, project.id));
  assert.equal(money.period, "this month");
  assert.deepEqual([money.summary.hours.actual, money.summary.cost.actual, money.summary.over], ["30 min", "$37.50", false], "October's hours do not count against November");
});

test("expenses: a receipt is stored with the file service, and a removed one leaves the totals", async () => {
  const deps = t.services.finance;
  const { project, client } = await wonProject(t.services, mikey);
  assert.deepEqual(finance.addExpense(deps, mikey, project.id, { category: "hosting", amount: "0", on: TODAY, receipt: { name: "r.pdf", bytes: PDF } }), { ok: false, error: "amount-must-be-positive" });
  assert.deepEqual(finance.addExpense(deps, mikey, project.id, { category: "hosting", amount: "12", on: TODAY, receipt: { name: "r.html", bytes: PDF } }), { ok: false, error: "file-type-not-allowed" });
  assert.equal(count(t.db, "file") + count(t.db, "expense"), 0, "a refused expense stores nothing");

  const expense = unwrap(finance.addExpense(deps, mikey, project.id, { category: "hosting", amount: "12.50", on: TODAY, note: "First month", receipt: { name: "receipt.pdf", bytes: PDF } }));
  const file = deps.files.get(expense.receiptFileId as Id);
  assert.deepEqual({ owner: file?.ownerType, organization: file?.organizationId, visible: file?.clientVisible }, { owner: "expense-receipt", organization: client.id, visible: false });
  const listed = unwrap(finance.projectMoney(deps, mikey, project.id)).expenses;
  assert.deepEqual(listed.map((e) => [e.categoryLabel, e.amount, e.note, e.receiptName]), [["Hosting", "$12.50", "First month", "receipt.pdf"]]);

  unwrap(finance.removeExpense(deps, mikey, expense.id));
  assert.deepEqual(unwrap(finance.projectMoney(deps, mikey, project.id)).expenses, []);
  assert.equal(unwrap(finance.projectMoney(deps, mikey, project.id)).summary.expenses, "$0.00");
  assert.equal(count(t.db, "expense"), 1);
  assert.deepEqual(finance.removeExpense(deps, mikey, expense.id), { ok: false, error: "not-found" });
});

test("exports open in a spreadsheet, are recorded, and cannot carry a formula", async () => {
  const deps = t.services.finance;
  const { project } = await wonProject(t.services, mikey);
  unwrap(finance.logTime(deps, mikey, { projectId: project.id }, { on: TODAY, hours: "1.5", note: '=HYPERLINK("http://evil","x"), then lunch' }));
  unwrap(finance.addExpense(deps, mikey, project.id, { category: "software", amount: "1,250.00", on: TODAY, note: "Licence" }));
  unwrap(finance.setProjectBudget(deps, mikey, project.id, { amount: "100", hours: "", rate: "" }));

  const time = unwrap(finance.exportFinance(deps, mikey, "time"));
  assert.equal(time.fileName, "hq-time-2026-11-16.csv");
  assert.equal(time.csv, '\uFEFFDate,Client,Project,Task,Person,Hours,Minutes,Billable,Note\r\n2026-11-16,Mt. Storm Bakery,Bakery website,,Mikey Nichols,1.5,90,yes,"\'=HYPERLINK(""http://evil"",""x""), then lunch"\r\n');
  const expenses = unwrap(finance.exportFinance(deps, mikey, "expenses"));
  assert.match(expenses.csv, /\r\n2026-11-16,Mt\. Storm Bakery,Bakery website,Software,1250,USD,Licence,,Mikey Nichols\r\n$/);
  const summary = unwrap(finance.exportFinance(deps, mikey, "projects"));
  assert.match(summary.csv, /\r\nMt\. Storm Bakery,Bakery website,active,so far,100,,1\.5,1\.5,112\.5,1250,1362\.5,-1262\.5,Not invoiced,\r\n$/, "a negative margin is a number, not text with an apostrophe");
  assert.deepEqual(finance.exportFinance(deps, mikey, "everything"), { ok: false, error: "not-found" });
  assert.deepEqual(events(t.db).filter((e) => e.action === "finance.exported").map((e) => e.context), [{ what: "time", rows: 1 }, { what: "expenses", rows: 1 }, { what: "projects", rows: 1 }]);
});

test("money is for admins and managers; a member logs time and sees no cost", async () => {
  const deps = t.services.finance;
  const { project } = await wonProject(t.services, mikey);
  const entry = unwrap(finance.logTime(deps, mikey, { projectId: project.id }, { on: TODAY, hours: "1" }));
  const expense = unwrap(finance.addExpense(deps, mikey, project.id, { category: "other", amount: "5", on: TODAY }));
  const before = count(t.db, "activity_event");

  const sam = addUser(t.db, "member", "Sam Helper");
  const memberRefused: { ok: boolean; error?: string }[] = [
    finance.addExpense(deps, sam, project.id, { category: "other", amount: "5", on: TODAY }),
    finance.removeExpense(deps, sam, expense.id),
    finance.setProjectBudget(deps, sam, project.id, { amount: "1", hours: "", rate: "" }),
    finance.setProjectPayment(deps, sam, project.id, { status: "paid" }),
    finance.projectMoney(deps, sam, project.id),
    finance.financeOverview(deps, sam),
    finance.projectsOverBudget(deps, sam),
    finance.exportFinance(deps, sam, "time"),
  ];
  memberRefused.forEach((answer, index) => assert.deepEqual(answer, { ok: false, error: "forbidden" }, `member call ${index}`));
  assert.equal(finance.logTime(deps, sam, { projectId: project.id }, { on: TODAY, hours: "1" }).ok, true);

  for (const actor of [addUser(t.db, null), null]) {
    const refused: { ok: boolean; error?: string }[] = [
      finance.logTime(deps, actor, { projectId: project.id }, { on: TODAY, hours: "1" }),
      finance.stopTimer(deps, actor),
      finance.removeTime(deps, actor, entry.id),
      finance.timeSheet(deps, actor),
      finance.hoursThisWeek(deps, actor),
      finance.projectMoney(deps, actor, project.id),
      finance.exportFinance(deps, actor, "time"),
    ];
    refused.forEach((answer, index) => assert.deepEqual(answer, { ok: false, error: "forbidden" }, `call ${index}`));
    assert.equal(finance.taskTime(deps, actor, entry.id).can, false);
  }
  assert.equal(count(t.db, "activity_event"), before + 1, "only the member's own time entry was written");
});

test("the nightly sheet copy sends the three tables, and records whether it worked", async () => {
  const deps = t.services.finance;
  const { project } = await wonProject(t.services, mikey);
  unwrap(finance.logTime(deps, mikey, { projectId: project.id }, { on: TODAY, hours: "1.5", note: "Menu" }));
  const sent: { name: string; rows: readonly (readonly (string | number | null)[])[] }[] = [];
  const result = await finance.syncFinanceSheet(deps, { describe: "a test sheet", replace: async (tabs) => void sent.push(...tabs) });
  assert.deepEqual(result, { rows: 2 });
  assert.deepEqual(sent.map((tab) => [tab.name, tab.rows.length]), [["HQ Time", 2], ["HQ Expenses", 1], ["HQ Projects", 2], ["HQ Invoices", 1], ["HQ Payments", 1]]);
  assert.deepEqual(sent[0]?.rows[1], [TODAY, "Mt. Storm Bakery", "Bakery website", "", "Mikey Nichols", 1.5, 90, "yes", "Menu"]);

  await assert.rejects(finance.syncFinanceSheet(deps, { describe: "a broken sheet", replace: async () => Promise.reject(new Error("Google Sheets write failed: HTTP 403")) }), /HTTP 403/);
  const recorded = events(t.db).filter((e) => e.action.startsWith("finance.sheet"));
  assert.deepEqual(recorded.map((e) => [e.actor, e.action, e.context]), [
    [null, "finance.sheet-synced", { rows: 2 }],
    [null, "finance.sheet-sync-failed", { reason: "Google Sheets write failed: HTTP 403" }],
  ]);
});

test("invoices: numbered in order, sent, paid by what is received, and the project's payment status follows", async () => {
  const deps = t.services.finance;
  const project = acceptedProject();
  const other = await wonProject(t.services, mikey, { client: "Gormania Feed", title: "Feed store site" });

  const suggestions = unwrap(finance.projectMoney(deps, mikey, project.id)).invoiceForm;
  assert.deepEqual(suggestions, { deposit: "800.00", balance: "2400.00", full: "2400.00" });

  const deposit = unwrap(finance.createInvoice(deps, mikey, project.id, { kind: "deposit", description: "Deposit, one third of the quote", amount: "800", dueOn: "2026-11-10" }));
  const elsewhere = unwrap(finance.createInvoice(deps, mikey, other.project.id, { kind: "full", description: "Website", amount: "500" }));
  assert.deepEqual([deposit.number, elsewhere.number], [1, 2]);
  unwrap(finance.addLineToInvoice(deps, mikey, deposit.id, { description: "Stock photos", amount: "37.50" }));
  assert.deepEqual(finance.invoiceDocument(deps, mikey, deposit.id), { ok: false, error: "not-found" }, "a draft has no PDF");
  assert.deepEqual(finance.recordPayment(deps, mikey, deposit.id, { amount: "100", method: "cash", on: TODAY }), { ok: false, error: "not-sent" });

  unwrap(finance.sendInvoiceNow(deps, mikey, deposit.id));
  assert.deepEqual(finance.addLineToInvoice(deps, mikey, deposit.id, { description: "x", amount: "1" }), { ok: false, error: "not-a-draft" });
  let money = unwrap(finance.projectMoney(deps, mikey, project.id));
  assert.equal(money.payment.statusLabel, "Invoiced");
  assert.deepEqual(money.invoices.map((i) => [i.label, i.kindLabel, i.status, i.total, i.owed, i.overdue]), [["INV-0001", "Deposit", "sent", "$837.50", "$837.50", true]]);
  assert.equal(money.invoiceForm.balance, "1562.50", "the balance is what has not been invoiced yet");

  const doc = unwrap(finance.invoiceDocument(deps, mikey, deposit.id));
  assert.deepEqual({ label: doc.label, client: doc.clientName, issued: doc.issuedOn, total: doc.total, file: doc.fileName, lines: doc.lines }, {
    label: "INV-0001",
    client: "Mt. Storm Bakery",
    issued: TODAY,
    total: "$837.50",
    file: "INV-0001.pdf",
    lines: [{ description: "Deposit, one third of the quote", amount: "$800.00" }, { description: "Stock photos", amount: "$37.50" }],
  });
  assert.equal(new TextDecoder().decode(t.services.renderInvoicePdf(doc).slice(0, 5)), "%PDF-");

  // Part, then the rest.
  unwrap(finance.recordPayment(deps, mikey, deposit.id, { amount: "400", method: "check", on: TODAY, reference: "Check 1041" }));
  assert.equal(unwrap(finance.projectMoney(deps, mikey, project.id)).payment.status, "invoiced");
  assert.deepEqual(finance.voidInvoiceNow(deps, mikey, deposit.id), { ok: false, error: "has-payments" });
  assert.deepEqual(finance.recordPayment(deps, mikey, deposit.id, { amount: "500", method: "cash", on: TODAY }), { ok: false, error: "more-than-is-owed" });
  const paid = unwrap(finance.recordPayment(deps, mikey, deposit.id, { amount: "437.50", method: "cash", on: TODAY }));
  assert.equal(paid.invoice.status, "paid");
  assert.equal(unwrap(finance.projectMoney(deps, mikey, project.id)).payment.statusLabel, "Deposit paid");

  // The balance: invoiced, then paid in full.
  const balance = unwrap(finance.createInvoice(deps, mikey, project.id, { kind: "balance", description: "Balance", amount: "1562.50" }));
  assert.equal(balance.number, 3);
  unwrap(finance.sendInvoiceNow(deps, mikey, balance.id));
  assert.equal(unwrap(finance.projectMoney(deps, mikey, project.id)).payment.status, "invoiced");
  unwrap(finance.recordPayment(deps, mikey, balance.id, { amount: "1,562.50", method: "check", on: TODAY, reference: "Check 1050" }));
  assert.equal(unwrap(finance.projectMoney(deps, mikey, project.id)).payment.statusLabel, "Paid in full");

  // A draft made by mistake is voided, and the numbers keep no gap.
  unwrap(finance.voidInvoiceNow(deps, mikey, elsewhere.id));
  assert.equal(unwrap(finance.createInvoice(deps, mikey, other.project.id, { kind: "full", description: "Website", amount: "550" })).number, 4);

  const detail = unwrap(finance.invoiceDetail(deps, mikey, deposit.id));
  assert.deepEqual(detail.payments.map((p) => [p.amount, p.methodLabel, p.reference]), [["$400.00", "Check", "Check 1041"], ["$437.50", "Cash", ""]]);
  assert.deepEqual(detail.can, { addLine: false, send: false, void: false, pay: false });

  const invoices = unwrap(finance.exportFinance(deps, mikey, "invoices")).csv.split("\r\n");
  assert.equal(invoices[1], "INV-0001,Mt. Storm Bakery,Bakery ordering app,Deposit,paid,2026-11-16,2026-11-10,837.5,837.5,0");
  assert.equal(invoices[2], "INV-0002,Gormania Feed,Feed store site,Full amount,void,,,500,0,0");
  const payments = unwrap(finance.exportFinance(deps, mikey, "payments")).csv.split("\r\n");
  assert.equal(payments[1], "2026-11-16,INV-0001,Mt. Storm Bakery,Bakery ordering app,400,USD,Check,Check 1041");
  assert.equal(payments.length, 5, "a header, three payments and the last line's end");

  const statuses = events(t.db).filter((e) => e.action === "project.payment-status-changed").map((e) => [e.context["from"], e.context["to"], e.context["invoiceNumber"]]);
  assert.deepEqual(statuses, [["not-invoiced", "invoiced", 1], ["invoiced", "deposit-paid", 1], ["deposit-paid", "invoiced", 3], ["invoiced", "paid", 3]]);

  // Admins and managers only.
  const sam = addUser(t.db, "member", "Sam Helper");
  const refused: { ok: boolean; error?: string }[] = [
    finance.createInvoice(deps, sam, project.id, { kind: "full", description: "x", amount: "1" }),
    finance.addLineToInvoice(deps, sam, deposit.id, { description: "x", amount: "1" }),
    finance.sendInvoiceNow(deps, sam, deposit.id),
    finance.voidInvoiceNow(deps, sam, deposit.id),
    finance.recordPayment(deps, sam, deposit.id, { amount: "1", method: "cash", on: TODAY }),
    finance.invoiceDetail(deps, sam, deposit.id),
    finance.invoiceDocument(deps, sam, deposit.id),
  ];
  refused.forEach((answer, index) => assert.deepEqual(answer, { ok: false, error: "forbidden" }, `call ${index}`));
});

test("accepting a proposal drafts its deposit invoice for Potomac to check and send", async () => {
  const deps = t.services.finance;
  const before = deps.invoices.list().length;
  const client = unwrap(crm.createClient(t.services.crm, mikey, { name: "Canaan Valley Inn" }));
  const opportunity = unwrap(crm.createOpportunity(t.services.crm, mikey, client.id, { title: "Booking site", leadSource: "phone", service: "application" }));
  for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(t.services.crm, mikey, opportunity.id, { to }));
  const draft = unwrap(proposals.startProposal(t.services.proposals, mikey, opportunity.id, {}));
  unwrap(proposals.sendProposalVersion(t.services.proposals, mikey, draft.id));
  const answer = unwrap(proposals.recordProposalDecision(t.services.proposals, mikey, draft.id, { decision: "accepted", byName: "Lee Inn", on: TODAY, method: "email" }));
  assert.ok(answer.project);

  const made = deps.invoices.listForProject(answer.project.id);
  assert.equal(deps.invoices.list().length, before + 1);
  assert.deepEqual(made.map((i) => [i.kind, i.status, i.total.minor, i.lines[0]?.description, i.dueOn]), [["deposit", "draft", 80000, "Deposit, one third of “Booking site”", null]]);
  assert.match(made[0]?.note ?? "", /Drafted by HQ when version 1 of the proposal was accepted\./);
  assert.equal(actions(t.db).at(-1), "invoice.drafted-from-proposal");
  const money = unwrap(finance.projectMoney(deps, mikey, answer.project.id));
  assert.equal(money.payment.status, "not-invoiced", "a draft sends nothing and changes nothing until it is sent");
  assert.equal(money.invoiceForm.balance, "1600.00", "the drafted deposit counts towards what is invoiced");
});

test("no deposit is drafted for hourly or monthly work, or when the project already has one", async () => {
  const deps = t.services.finance;
  const project = acceptedProject();
  const before = deps.invoices.listForProject(project.id).length;
  assert.equal(finance.applyDepositDraft(deps, mikey, { projectId: project.id, ownerId: mikey, deposit: null, title: "x", version: 1 }), null);
  const first = finance.applyDepositDraft(deps, null, { projectId: project.id, ownerId: mikey, deposit: { minor: 50000, currency: "USD" }, title: "Bakery ordering app", version: 2 });
  assert.ok(first);
  assert.equal(first.createdBy, mikey, "accepted in the portal: credited to the project's owner");
  assert.equal(finance.applyDepositDraft(deps, mikey, { projectId: project.id, ownerId: mikey, deposit: { minor: 50000, currency: "USD" }, title: "again", version: 3 }), null);
  assert.equal(deps.invoices.listForProject(project.id).length, before + 1);
});
