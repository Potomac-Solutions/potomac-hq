// Decision 0021 against a real database: a company project (Potomac's own
// work, no client) is started, planned and worked like any project, shows on
// the company board with everyone's to-dos, and never bills or reaches a
// portal.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import * as finance from "../../src/finance/index.ts";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { addTodo } from "../../src/todos/index.ts";
import { actions, addUser, events, testDb, unwrap, wonProject, type TestDb } from "../support/harness.ts";

let t: TestDb;
let mikey: Id;
let jayanti: Id;
const TODAY = "2026-11-27";

beforeEach(() => {
  t = testDb({ today: () => TODAY });
  mikey = addUser(t.db, "admin", "Mikey Nichols");
  jayanti = addUser(t.db, "admin", "Jayanti Nichols");
});
afterEach(() => t.close());

test("an admin starts a company project; a member may not", () => {
  const deps = t.services.projects;
  const sam = addUser(t.db, "member", "Sam Helper");
  const manager = addUser(t.db, "manager", "Morgan Manager");

  assert.deepEqual(projects.startCompanyProject(deps, sam, { name: "Training", kind: "ongoing" }), { ok: false, error: "forbidden" });
  assert.deepEqual(projects.startCompanyProject(deps, mikey, { name: " ", kind: "ongoing" }), { ok: false, error: "name-missing" });
  assert.deepEqual(projects.startCompanyProject(deps, mikey, { name: "Training", kind: "forever" }), { ok: false, error: "invalid-kind" });
  assert.deepEqual(projects.startCompanyProject(deps, mikey, { name: "Training", kind: "ongoing", ownerId: "00000000-0000-4000-8000-000000000000" as Id }), { ok: false, error: "person-not-found" });

  const training = unwrap(projects.startCompanyProject(deps, mikey, { name: "Training and certifications", kind: "ongoing", ownerId: jayanti, description: "Cloud and commerce certificates." }));
  assert.deepEqual({ org: training.organizationId, opp: training.opportunityId, owner: training.ownerId, status: training.status }, { org: null, opp: null, owner: jayanti, status: "active" });
  unwrap(projects.startCompanyProject(deps, manager, { name: "Website", kind: "fixed" }));

  const started = events(t.db).filter((e) => e.action === "project.created");
  assert.equal(started.length, 2);
  assert.deepEqual(started[0]?.context, { company: true, kind: "ongoing", name: "Training and certifications", ownerId: jayanti });

  const list = unwrap(projects.listProjects(deps, mikey));
  assert.deepEqual(
    list.projects.map((p) => [p.name, p.clientName, p.company]),
    [
      ["Website", "Company work", true],
      ["Training and certifications", "Company work", true],
    ],
  );
  assert.equal(list.canStart, true);
  assert.equal(unwrap(projects.listProjects(deps, sam)).canStart, false);

  const view = unwrap(projects.projectOverview(deps, mikey, training.id));
  assert.deepEqual({ company: view.company, clientId: view.clientId, clientName: view.clientName, opportunityId: view.opportunityId, deliverables: view.can.editDeliverables }, { company: true, clientId: "", clientName: "Company work", opportunityId: "", deliverables: false });
});

test("a company project's tasks are assigned and moved, and the company board shows them with everyone's to-dos", async () => {
  const deps = t.services.projects;
  const training = unwrap(projects.startCompanyProject(deps, mikey, { name: "Training and certifications", kind: "ongoing" }));
  const client = await wonProject(t.services, mikey);

  const aws = unwrap(projects.addTask(deps, mikey, training.id, { title: "AWS Solutions Architect", assigneeId: jayanti, dueOn: "2027-03-01" }));
  const shopify = unwrap(projects.addTask(deps, jayanti, training.id, { title: "Shopify Partner certification", assigneeId: mikey }));
  unwrap(projects.addTask(deps, mikey, client.project.id, { title: "Draft the menu page", assigneeId: mikey }));
  const todo = unwrap(addTodo(t.services.todos, mikey, { title: "Call the accountant", assigneeId: jayanti }));

  unwrap(projects.moveTaskStatus(deps, jayanti, aws.id, "doing"));

  const board = unwrap(projects.board(deps, mikey));
  assert.equal(board.withTodos, true);
  const where = Object.fromEntries(board.columns.flatMap((column) => column.cards.map((card) => [card.title, [column.status, card.projectName, card.assigneeName, card.todo]])));
  assert.deepEqual(where, {
    "AWS Solutions Architect": ["doing", "Training and certifications", "Jayanti Nichols", false],
    "Shopify Partner certification": ["todo", "Training and certifications", "Mikey Nichols", false],
    "Draft the menu page": ["todo", "Bakery website", "Mikey Nichols", false],
    "Call the accountant": ["todo", "To-do", "Jayanti Nichols", true],
  });
  assert.deepEqual(board.todoStatuses.map((s) => s.value), ["todo", "done"]);

  // Hers alone: the certificate she's working on and the to-do she was given.
  const hers = unwrap(projects.board(deps, jayanti, { mine: true }));
  assert.deepEqual(hers.columns.flatMap((column) => column.cards.map((card) => card.title)).sort(), ["AWS Solutions Architect", "Call the accountant"]);

  // A to-do goes only to done, with a clear refusal otherwise.
  assert.deepEqual(projects.moveTaskStatus(deps, jayanti, todo.id, "doing"), { ok: false, error: "todo-has-no-board" });
  unwrap(projects.moveTaskStatus(deps, jayanti, todo.id, "done"));
  const after = unwrap(projects.board(deps, mikey));
  assert.ok(after.columns.find((c) => c.status === "done")?.cards.some((card) => card.title === "Call the accountant"), "a finished to-do stays in Done for two weeks");

  // A project's own board has no to-dos.
  const own = unwrap(projects.board(deps, mikey, { projectId: training.id }));
  assert.equal(own.withTodos, false);
  assert.deepEqual(own.columns.flatMap((column) => column.cards.map((card) => card.title)).sort(), ["AWS Solutions Architect", "Shopify Partner certification"]);

  assert.ok(actions(t.db).includes("task.moved"));
  void shopify;
});

test("a company project bills nothing: no invoices, no client milestones, and its time isn't billable", () => {
  const training = unwrap(projects.startCompanyProject(t.services.projects, mikey, { name: "Training and certifications", kind: "ongoing" }));

  assert.deepEqual(finance.createInvoice(t.services.finance, mikey, training.id, { kind: "full", description: "x", amount: "10" }), { ok: false, error: "company-project" });
  assert.deepEqual(finance.addRecurringInvoice(t.services.finance, mikey, training.id, { description: "x", amount: "10", every: "month", firstOn: TODAY }), { ok: false, error: "company-project" });
  assert.deepEqual(projects.addMilestone(t.services.projects, mikey, training.id, { name: "Send photos", forClient: true }), { ok: false, error: "company-project" });
  const exam = unwrap(projects.addMilestone(t.services.projects, mikey, training.id, { name: "AWS exam passed" }));
  assert.deepEqual(projects.setMilestoneForClient(t.services.projects, mikey, exam.id, true), { ok: false, error: "company-project" });

  const logged = unwrap(finance.logTime(t.services.finance, mikey, { projectId: training.id }, { on: TODAY, hours: "1.5", billable: true }));
  assert.equal(logged.billable, false);

  // Working on a task starts a timer that isn't billable either, and it shows as running.
  const task = unwrap(projects.addTask(t.services.projects, mikey, training.id, { title: "Study for the exam", assigneeId: mikey }));
  unwrap(projects.moveTaskStatus(t.services.projects, mikey, task.id, "doing"));
  const running = t.services.finance.time.running(mikey);
  assert.ok(running, "the timer on a company task is found, so it can be stopped");
  assert.equal(running.billable, false);
  assert.equal(running.clientName, "Company work");
});
