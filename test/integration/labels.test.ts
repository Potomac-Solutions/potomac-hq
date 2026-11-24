// Labels (decision 0007, section 2) against a real database and over real
// HTTP: making them, putting them on tasks, renaming and deleting them, and
// who may do which.
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, addUser, count, events, signIn, testApp, testDb, unwrap, wonProject, type Client, type TestApp, type TestDb } from "../support/harness.ts";

let t: TestDb;
let mikey: Id;
let member: Id;

beforeEach(() => {
  t = testDb();
  mikey = addUser(t.db, "admin", "Mikey Nichols");
  member = addUser(t.db, "member", "Sam Member");
});
afterEach(() => t.close());

test("a label is made once, whatever its capitals, and put on a task with the change recorded", async () => {
  const deps = t.services.projects;
  const { project } = await wonProject(t.services, mikey);
  const task = unwrap(projects.addTask(deps, mikey, project.id, { title: "Draft the menu page" }));

  const website = unwrap(projects.addLabel(deps, member, { name: "Website", colour: "blue" }));
  assert.deepEqual(projects.addLabel(deps, member, { name: " website " }), { ok: false, error: "name-taken" });
  assert.deepEqual(projects.addLabel(deps, member, { name: "Waiting", colour: "neon" }), { ok: false, error: "invalid-colour" });

  // Tick one and type a new one: the new one is made and both go on.
  unwrap(projects.setTaskLabels(deps, member, task.id, { labelIds: [website.id], newName: "Waiting on client" }));
  const on = projects.taskDetail(deps, member, task.id);
  assert.ok(on.ok);
  assert.deepEqual(
    on.value.task.labels.map((label) => label.name),
    ["Waiting on client", "Website"],
  );
  assert.deepEqual(
    on.value.labelChoices.map((choice) => [choice.name, choice.on]),
    [
      ["Waiting on client", true],
      ["Website", true],
    ],
  );

  // Typing a name that exists puts that label on; it doesn't make a second.
  unwrap(projects.setTaskLabels(deps, member, task.id, { labelIds: [], newName: "WEBSITE" }));
  assert.equal(count(t.db, "label"), 2);
  const after = projects.taskDetail(deps, member, task.id);
  assert.ok(after.ok);
  assert.deepEqual(
    after.value.task.labels.map((label) => label.name),
    ["Website"],
  );

  assert.deepEqual(projects.setTaskLabels(deps, member, task.id, { labelIds: [website.id] }), { ok: false, error: "unchanged" });
  const labelled = events(t.db).filter((event) => event.action === "task.labelled");
  assert.equal(labelled.length, 2);
  assert.deepEqual(labelled[1]?.context, { projectId: project.id, title: "Draft the menu page", added: [], removed: ["Waiting on client"] });
  assert.ok(actions(t.db).includes("label.added"));
});

test("the board and the task list show each task's labels", async () => {
  const deps = t.services.projects;
  const { project } = await wonProject(t.services, mikey);
  const one = unwrap(projects.addTask(deps, mikey, project.id, { title: "One" }));
  unwrap(projects.addTask(deps, mikey, project.id, { title: "Two" }));
  unwrap(projects.setTaskLabels(deps, mikey, one.id, { labelIds: [], newName: "Website", newColour: "teal" }));

  const board = projects.board(deps, mikey, { projectId: project.id });
  assert.ok(board.ok);
  const cards = board.value.columns.flatMap((column) => column.cards);
  assert.deepEqual(
    cards.map((card) => [card.title, card.labels.map((label) => `${label.name}:${label.colour}`)]),
    [
      ["One", ["Website:teal"]],
      ["Two", []],
    ],
  );
  const list = projects.projectTasks(deps, mikey, project.id);
  assert.ok(list.ok);
  assert.deepEqual(list.value.tasks.find((task) => task.title === "One")?.labels.map((label) => label.name), ["Website"]);
});

test("renaming, recolouring and deleting a label is for admins and managers; deleting takes it off its tasks", async () => {
  const deps = t.services.projects;
  const manager = addUser(t.db, "manager", "Morgan Manager");
  const { project } = await wonProject(t.services, mikey);
  const task = unwrap(projects.addTask(deps, mikey, project.id, { title: "Draft the menu page" }));
  const label = unwrap(projects.addLabel(deps, member, { name: "Website", colour: "blue" }));
  unwrap(projects.addLabel(deps, member, { name: "Hosting" }));
  unwrap(projects.setTaskLabels(deps, member, task.id, { labelIds: [label.id] }));

  assert.deepEqual(projects.editLabelDetails(deps, member, label.id, { name: "Site" }), { ok: false, error: "forbidden" });
  assert.deepEqual(projects.removeLabel(deps, member, label.id), { ok: false, error: "forbidden" });
  assert.deepEqual(projects.editLabelDetails(deps, manager, label.id, { name: "hosting" }), { ok: false, error: "name-taken" });
  assert.deepEqual(projects.editLabelDetails(deps, manager, label.id, { name: "Website", colour: "" }), { ok: false, error: "unchanged" });
  // Only its capitals change: still the same label, so that is allowed.
  assert.deepEqual(unwrap(projects.editLabelDetails(deps, manager, label.id, { name: "website", colour: "red" })), { id: label.id, name: "website", colour: "red" });

  const page = projects.labelsPage(deps, member);
  assert.ok(page.ok);
  assert.deepEqual(
    page.value.labels.map((row) => [row.name, row.tasks]),
    [
      ["Hosting", 0],
      ["website", 1],
    ],
  );
  assert.equal(page.value.canManage, false);
  assert.equal(page.value.canAdd, true);

  unwrap(projects.removeLabel(deps, manager, label.id));
  assert.equal(count(t.db, "task_label"), 0);
  assert.equal(count(t.db, "task"), 1, "the task stays");
  assert.deepEqual(events(t.db).find((event) => event.action === "label.removed")?.context, { name: "website", tasks: 1 });
});

test("labels need task permissions, and a label that was deleted can't be ticked", async () => {
  const deps = t.services.projects;
  const nobody = addUser(t.db, null, "No Role");
  const { project } = await wonProject(t.services, mikey);
  const task = unwrap(projects.addTask(deps, mikey, project.id, { title: "Draft the menu page" }));
  assert.deepEqual(projects.addLabel(deps, nobody, { name: "Website" }), { ok: false, error: "forbidden" });
  assert.deepEqual(projects.setTaskLabels(deps, nobody, task.id, { labelIds: [] }), { ok: false, error: "forbidden" });
  assert.deepEqual(projects.labelsPage(deps, nobody), { ok: false, error: "forbidden" });
  assert.deepEqual(projects.setTaskLabels(deps, mikey, task.id, { labelIds: ["00000000-0000-4000-8000-000000000099" as Id] }), { ok: false, error: "label-not-found" });
});

// Over HTTP: the task page's picker, the Labels page, and a member's view of it.
let app: TestApp;
let admin: Client;
let taskId = "";

before(async () => {
  app = await testApp();
  admin = await signIn(app, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const id = app.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const { project } = await wonProject(app.services, id);
  taskId = unwrap(projects.addTask(app.services.projects, id, project.id, { title: "Draft the menu page" })).id;
});
after(() => app.stop());

test("the task page puts labels on, and the Labels page lists, renames and deletes them", async () => {
  const made = await admin.submit(`/tasks/${taskId}/labels`, { newLabel: "Website", newColour: "violet" });
  assert.match(made.location, new RegExp(`^/tasks/${taskId}\\?done=`));
  assert.match(made.html, /Labels saved\./);
  assert.match(made.html, /<li data-colour="violet">Website<\/li>/);

  const labelId = (app.db.prepare("select id from label where name = 'Website'").get()?.["id"] ?? "") as string;
  assert.match(made.html, new RegExp(`name="label-${labelId}" value="1" checked`));

  // Unticking it (sending no label-… field) takes it off.
  const off = await admin.submit(`/tasks/${taskId}/labels`, {});
  assert.match(off.html, /Labels saved\./);
  assert.equal(count(app.db, "task_label"), 0);

  const list = await admin.page("/labels");
  assert.match(list, /<h1>Labels<\/h1>/);
  assert.match(list, /Rename or recolour/);
  const renamed = await admin.submit(`/labels/${labelId}`, { name: "Websites", colour: "green" });
  assert.match(renamed.html, /Label saved\./);
  assert.match(renamed.html, /<li data-colour="green">Websites<\/li>/);
  const gone = await admin.submit(`/labels/${labelId}/remove`, {});
  assert.match(gone.html, /Label deleted, and taken off its tasks\./);
  assert.match(gone.html, /No labels yet/);

  const sam = await signIn(app, "sam@example.com", "Sam Member", ["member"]);
  await sam.submit("/labels", { name: "Hosting", colour: "" });
  const theirs = await sam.page("/labels");
  assert.match(theirs, /Hosting/);
  assert.doesNotMatch(theirs, /Rename or recolour/, "a member sees the list without the forms");
  const refused = await sam.submit(`/labels/${(app.db.prepare("select id from label where name = 'Hosting'").get()?.["id"] ?? "") as string}/remove`, {});
  assert.match(refused.html, /You don’t have permission to do that\./);
});
