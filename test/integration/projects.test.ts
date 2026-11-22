// v0.3's services against a real database: a project's details, plan, tasks,
// board, deliverables, notes and history, with a refusal for every permission.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { openFile, openFileForClient } from "../../src/files/index.ts";
import { changeTheme } from "../../src/identity/index.ts";
import { addNote, listNotes } from "../../src/notes/index.ts";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, addUser, count, events, PDF, testDb, unwrap, wonProject, type TestDb } from "../support/harness.ts";

let t: TestDb;
let mikey: Id;
const TODAY = "2026-11-16";

beforeEach(() => {
  t = testDb({ today: () => TODAY });
  mikey = addUser(t.db, "admin", "Mikey Nichols");
});
afterEach(() => t.close());

test("a project gets details, an owner, a plan and a next milestone", async () => {
  const deps = t.services.projects;
  const { project, client } = await wonProject(t.services, mikey);
  const sam = addUser(t.db, "member", "Sam Helper");

  unwrap(projects.editProjectDetails(deps, mikey, project.id, { name: "Bakery site", description: "Menu first.", health: "at-risk", startOn: "2026-11-20", targetOn: "2027-01-15" }));
  unwrap(projects.setProjectOwner(deps, mikey, project.id, sam));
  assert.deepEqual(projects.setProjectOwner(deps, mikey, project.id, "00000000-0000-4000-8000-000000000000" as Id), { ok: false, error: "person-not-found" });

  const design = unwrap(projects.addPhase(deps, mikey, project.id, { name: "Design" }));
  const build = unwrap(projects.addPhase(deps, mikey, project.id, { name: "Build" }));
  assert.deepEqual([design.position, build.position], [0, 1]);
  unwrap(projects.addMilestone(deps, mikey, project.id, { name: "Launch" }));
  const signedOff = unwrap(projects.addMilestone(deps, mikey, project.id, { name: "Design signed off", dueOn: "2026-12-05", phaseId: design.id }));
  const late = unwrap(projects.addMilestone(deps, mikey, project.id, { name: "Kickoff call", dueOn: "2026-11-10" }));

  let view = unwrap(projects.projectOverview(deps, mikey, project.id));
  assert.equal(view.project.name, "Bakery site");
  assert.equal(view.project.healthLabel, "At risk");
  assert.equal(view.project.ownerName, "Sam Helper");
  assert.equal(view.clientId, client.id);
  assert.deepEqual({ name: view.next?.name, overdue: view.next?.overdue }, { name: "Kickoff call", overdue: true });
  assert.deepEqual(view.progress, { done: 0, total: 3 });

  unwrap(projects.setMilestoneDone(deps, mikey, late.id, true));
  assert.deepEqual(projects.setMilestoneDone(deps, mikey, late.id, true), { ok: false, error: "already-done" });
  view = unwrap(projects.projectOverview(deps, mikey, project.id));
  assert.deepEqual({ name: view.next?.name, phase: view.next?.phaseName, due: view.next?.dueOn }, { name: "Design signed off", phase: "Design", due: "2026-12-05" });
  assert.equal(view.milestones.find((m) => m.id === late.id)?.doneOn, TODAY);
  unwrap(projects.setMilestoneDone(deps, mikey, signedOff.id, true));
  assert.equal(unwrap(projects.projectOverview(deps, mikey, project.id)).next?.name, "Launch", "an undated milestone is still the next one when it is the only one open");

  const list = unwrap(projects.listProjects(deps, mikey));
  assert.deepEqual(list.projects.map((p) => [p.name, p.clientName, p.ownerName, p.next]), [["Bakery site", "Mt. Storm Bakery", "Sam Helper", "Launch"]]);
  assert.deepEqual(unwrap(projects.listProjects(deps, mikey, { status: "completed" })).projects, []);

  // A phase of another project is refused.
  const other = await wonProject(t.services, mikey, { client: "Gormania Feed", title: "Feed store site" });
  assert.deepEqual(projects.addMilestone(deps, mikey, other.project.id, { name: "x", phaseId: build.id }), { ok: false, error: "phase-not-in-project" });

  const wanted = ["project.edited", "project.owner-changed", "phase.added", "phase.added", "milestone.added", "milestone.added", "milestone.added", "milestone.completed", "milestone.completed"];
  assert.deepEqual(actions(t.db).filter((a) => wanted.includes(a)), wanted);
  const history = unwrap(projects.projectOverview(deps, mikey, project.id)).history.map((h) => h.text);
  assert.equal(history[0], "Mikey Nichols completed a milestone");
  assert.ok(history.includes("Mikey Nichols started a project"), "the event that made the project is part of its history");
  assert.deepEqual(
    unwrap(projects.projectOverview(deps, mikey, other.project.id)).history.map((h) => h.text),
    ["Mikey Nichols started a project", "Mikey Nichols turned an opportunity into a project"],
    "another project's history holds only its own events",
  );
});

test("tasks: add, edit, move, list by urgency, and the board", async () => {
  const deps = t.services.projects;
  const { project } = await wonProject(t.services, mikey);
  const sam = addUser(t.db, "member", "Sam Helper");

  const menu = unwrap(projects.addTask(deps, mikey, project.id, { title: "Draft the menu page", assigneeId: sam, priority: "high", dueOn: "2026-11-10", estimate: "1.5" }));
  const logo = unwrap(projects.addTask(deps, mikey, project.id, { title: "Clean up the logo" }));
  const hosting = unwrap(projects.addTask(deps, mikey, project.id, { title: "Set up hosting", priority: "urgent", assigneeId: mikey }));
  assert.deepEqual(projects.addTask(deps, mikey, project.id, { title: "x", assigneeId: "00000000-0000-4000-8000-000000000000" as Id }), { ok: false, error: "person-not-found" });

  const listed = unwrap(projects.projectTasks(deps, mikey, project.id));
  assert.deepEqual(listed.tasks.map((task) => task.title), ["Set up hosting", "Draft the menu page", "Clean up the logo"]);
  assert.deepEqual({ who: listed.tasks[1]?.assigneeName, overdue: listed.tasks[1]?.overdue, estimate: listed.tasks[1]?.estimate }, { who: "Sam Helper", overdue: true, estimate: "1.5" });

  unwrap(projects.moveTaskStatus(deps, sam, menu.id, "doing"));
  unwrap(projects.moveTaskStatus(deps, mikey, logo.id, "done"));
  assert.deepEqual(projects.moveTaskStatus(deps, mikey, logo.id, "done"), { ok: false, error: "unchanged" });
  unwrap(projects.updateTask(deps, mikey, menu.id, { title: "Draft the menu page", assigneeId: sam, priority: "normal", dueOn: "2026-11-30" }));

  const all = unwrap(projects.board(deps, mikey));
  assert.deepEqual(all.columns.map((c) => [c.status, c.cards.map((card) => card.title)]), [
    ["todo", ["Set up hosting"]],
    ["doing", ["Draft the menu page"]],
    ["blocked", []],
    ["done", ["Clean up the logo"]],
  ]);
  assert.equal(all.returnTo, "/board");
  const mine = unwrap(projects.board(deps, sam, { mine: true }));
  assert.deepEqual(mine.columns.flatMap((c) => c.cards.map((card) => card.title)), ["Draft the menu page"]);
  assert.equal(mine.returnTo, "/board?mine=1");
  assert.equal(unwrap(projects.board(deps, mikey, { projectId: project.id })).returnTo, `/projects/${project.id}/board`);

  // A task finished more than two weeks ago leaves the board.
  t.db.prepare("update task set done_at = '2026-10-20T10:00:00.000Z' where id = ?").run(logo.id);
  assert.deepEqual(unwrap(projects.board(deps, mikey)).columns[3]?.cards, []);

  const detail = unwrap(projects.taskDetail(deps, mikey, hosting.id));
  assert.deepEqual({ title: detail.task.title, who: detail.task.assigneeId, project: detail.task.projectName }, { title: "Set up hosting", who: mikey, project: "Bakery website" });

  const moved = events(t.db).filter((event) => event.action === "task.moved");
  assert.deepEqual(moved.map((event) => event.context), [
    { projectId: project.id, from: "todo", to: "doing" },
    { projectId: project.id, from: "todo", to: "done" },
  ]);
});

test("the dashboard's panels: active projects and what is due soon", async () => {
  const deps = t.services.projects;
  const { project } = await wonProject(t.services, mikey);
  unwrap(projects.addMilestone(deps, mikey, project.id, { name: "Design signed off", dueOn: "2026-11-20" }));
  unwrap(projects.addMilestone(deps, mikey, project.id, { name: "Launch", dueOn: "2027-02-01" }));
  unwrap(projects.addTask(deps, mikey, project.id, { title: "Send the questionnaire", dueOn: "2026-11-14" }));
  const done = unwrap(projects.addTask(deps, mikey, project.id, { title: "Book the kickoff", dueOn: "2026-11-15" }));
  unwrap(projects.moveTaskStatus(deps, mikey, done.id, "done"));

  assert.deepEqual(unwrap(projects.upcomingDeadlines(deps, mikey)).items.map((item) => [item.kind, item.title, item.dueOn, item.overdue]), [
    ["Task", "Send the questionnaire", "2026-11-14", true],
    ["Milestone", "Design signed off", "2026-11-20", false],
  ]);
  assert.deepEqual(unwrap(projects.activeProjects(deps, mikey)).items.map((item) => [item.name, item.next]), [["Bakery website", "Design signed off, due Fri, Nov 20, in 4 days"]]);

  unwrap(projects.setProjectStatus(deps, mikey, project.id, "completed"));
  assert.deepEqual(unwrap(projects.activeProjects(deps, mikey)).items, []);
  assert.deepEqual(unwrap(projects.upcomingDeadlines(deps, mikey)).items, [], "a closed project's dates are no longer deadlines");
  assert.deepEqual(projects.addTask(deps, mikey, project.id, { title: "x" }), { ok: false, error: "project-closed" });
  assert.deepEqual(projects.addPhase(deps, mikey, project.id, { name: "x" }), { ok: false, error: "project-closed" });
  assert.deepEqual(projects.setProjectStatus(deps, mikey, project.id, "cancelled"), { ok: false, error: "final" });
});

test("deliverables: the file is stored, downloads are checked and recorded, sharing shows it to the client", async () => {
  const deps = t.services.projects;
  const { project, client } = await wonProject(t.services, mikey);
  const other = await wonProject(t.services, mikey, { client: "Gormania Feed", title: "Feed store site" });

  assert.deepEqual(projects.addDeliverable(deps, mikey, project.id, { title: "Design", file: null }), { ok: false, error: "file-missing" });
  assert.deepEqual(projects.addDeliverable(deps, mikey, project.id, { title: "Design", file: { name: "design.exe", bytes: PDF } }), { ok: false, error: "file-type-not-allowed" });
  assert.deepEqual(projects.addDeliverable(deps, mikey, project.id, { title: "", file: { name: "design.pdf", bytes: PDF } }), { ok: false, error: "title-missing" });
  assert.equal(count(t.db, "file"), 0, "a refused deliverable stores no file");

  const deliverable = unwrap(projects.addDeliverable(deps, mikey, project.id, { title: "Home page design", description: "First pass.", file: { name: "design.pdf", bytes: PDF } }));
  assert.equal(count(t.db, "file_blob"), 1);
  const row = unwrap(projects.projectOverview(deps, mikey, project.id)).deliverables[0];
  assert.deepEqual({ title: row?.title, file: row?.fileName, status: row?.status, share: row?.canShare, unshare: row?.canUnshare }, { title: "Home page design", file: "design.pdf", status: "draft", share: true, unshare: false });

  const opened = unwrap(openFile(deps, mikey, deliverable.fileId));
  assert.deepEqual([...opened.body], [...PDF]);
  assert.equal(opened.record.contentType, "application/pdf");
  assert.equal(opened.record.organizationId, client.id);

  // A client sees it only once it is shared, and only their own.
  const clientUser = { clientUserId: "11111111-1111-4111-8111-111111111111" as Id, organizationId: client.id };
  const stranger = { clientUserId: "22222222-2222-4222-8222-222222222222" as Id, organizationId: other.client.id };
  assert.deepEqual(openFileForClient(deps, clientUser, deliverable.fileId), { ok: false, error: "not-found" });
  unwrap(projects.setDeliverableShared(deps, mikey, deliverable.id, true));
  assert.equal(unwrap(openFileForClient(deps, clientUser, deliverable.fileId)).record.name, "design.pdf");
  assert.deepEqual(openFileForClient(deps, stranger, deliverable.fileId), { ok: false, error: "not-found" });
  assert.deepEqual(openFileForClient(deps, null, deliverable.fileId), { ok: false, error: "not-found" });
  assert.deepEqual(projects.setDeliverableShared(deps, mikey, deliverable.id, true), { ok: false, error: "already-shared" });
  unwrap(projects.setDeliverableShared(deps, mikey, deliverable.id, false));
  assert.deepEqual(openFileForClient(deps, clientUser, deliverable.fileId), { ok: false, error: "not-found" });

  const wanted = ["file.uploaded", "deliverable.added", "file.downloaded", "deliverable.shared", "file.downloaded", "deliverable.unshared"];
  assert.deepEqual(actions(t.db).filter((a) => wanted.includes(a)), wanted);
  const downloads = events(t.db).filter((event) => event.action === "file.downloaded");
  assert.deepEqual(downloads.map((event) => [event.actor, event.context["by"]]), [[mikey, "user"], [null, "client"]]);
  assert.ok(unwrap(projects.projectOverview(deps, mikey, project.id)).history.some((h) => h.text === "Mikey Nichols uploaded a file"));
});

test("notes are kept on a record, newest first, and need the record's own permission", async () => {
  const deps = t.services.notes;
  const { project, client, opportunity } = await wonProject(t.services, mikey);
  unwrap(addNote(deps, mikey, { recordType: "project", recordId: project.id, body: "Called Ann. Menu first." }));
  unwrap(addNote(deps, mikey, { recordType: "project", recordId: project.id, body: "She sent the photos." }));
  unwrap(addNote(deps, mikey, { recordType: "client-organization", recordId: client.id, body: "Closed on Mondays." }));
  unwrap(addNote(deps, mikey, { recordType: "opportunity", recordId: opportunity.id, body: "Budget is tight." }));

  const onProject = listNotes(deps, mikey, "project", project.id);
  assert.deepEqual(onProject.items.map((note) => [note.body, note.authorName]), [["She sent the photos.", "Mikey Nichols"], ["Called Ann. Menu first.", "Mikey Nichols"]]);
  assert.equal(onProject.canAdd, true);
  assert.equal(listNotes(deps, mikey, "client-organization", client.id).items.length, 1);

  assert.deepEqual(addNote(deps, mikey, { recordType: "project", recordId: client.id, body: "x" }), { ok: false, error: "not-found" }, "the id must be of that kind of record");
  assert.deepEqual(addNote(deps, mikey, { recordType: "user", recordId: mikey, body: "x" }), { ok: false, error: "invalid-record-type" });
  assert.deepEqual(addNote(deps, mikey, { recordType: "project", recordId: project.id, body: " " }), { ok: false, error: "note-empty" });

  const nobody = addUser(t.db, null);
  assert.deepEqual(addNote(deps, nobody, { recordType: "project", recordId: project.id, body: "x" }), { ok: false, error: "forbidden" });
  assert.deepEqual(listNotes(deps, nobody, "project", project.id), { recordType: "project", recordId: project.id, canAdd: false, items: [] });
  assert.equal(count(t.db, "note"), 4);
  assert.ok(unwrap(projects.projectOverview(t.services.projects, mikey, project.id)).history.some((h) => h.text === "Mikey Nichols wrote a note"));
});

test("a theme is a person's own choice, and is recorded", () => {
  const deps = t.services.session;
  assert.equal(deps.users.themeOf(mikey), "system");
  unwrap(changeTheme(deps, mikey, "dark"));
  assert.equal(deps.users.themeOf(mikey), "dark");
  assert.deepEqual(changeTheme(deps, mikey, "neon"), { ok: false, error: "invalid-theme" });
  assert.deepEqual(changeTheme(deps, null, "dark"), { ok: false, error: "forbidden" });
  t.db.prepare("update user set status = 'disabled' where id = ?").run(mikey);
  assert.deepEqual(changeTheme(deps, mikey, "light"), { ok: false, error: "forbidden" });
  assert.deepEqual(events(t.db).filter((e) => e.action === "user.theme-changed").map((e) => e.context), [{ theme: "dark" }]);
});

test("every change and every read is refused without its permission, and writes nothing", async () => {
  const deps = t.services.projects;
  const { project } = await wonProject(t.services, mikey);
  const phase = unwrap(projects.addPhase(deps, mikey, project.id, { name: "Design" }));
  const milestone = unwrap(projects.addMilestone(deps, mikey, project.id, { name: "Launch" }));
  const task = unwrap(projects.addTask(deps, mikey, project.id, { title: "Draft" }));
  const deliverable = unwrap(projects.addDeliverable(deps, mikey, project.id, { title: "Design", file: { name: "d.pdf", bytes: PDF } }));
  const before = { events: count(t.db, "activity_event"), tasks: count(t.db, "task"), files: count(t.db, "file") };

  for (const actor of [addUser(t.db, null), null]) {
    const refused: { ok: boolean; error?: string }[] = [
      projects.editProjectDetails(deps, actor, project.id, { name: "x", health: "on-track" }),
      projects.setProjectStatus(deps, actor, project.id, "cancelled"),
      projects.setProjectOwner(deps, actor, project.id, mikey),
      projects.addPhase(deps, actor, project.id, { name: "x" }),
      projects.addMilestone(deps, actor, project.id, { name: "x", phaseId: phase.id }),
      projects.setMilestoneDone(deps, actor, milestone.id, true),
      projects.addTask(deps, actor, project.id, { title: "x" }),
      projects.updateTask(deps, actor, task.id, { title: "x" }),
      projects.moveTaskStatus(deps, actor, task.id, "done"),
      projects.addDeliverable(deps, actor, project.id, { title: "x", file: { name: "d.pdf", bytes: PDF } }),
      projects.setDeliverableShared(deps, actor, deliverable.id, true),
      projects.listProjects(deps, actor),
      projects.projectOverview(deps, actor, project.id),
      projects.projectTasks(deps, actor, project.id),
      projects.taskDetail(deps, actor, task.id),
      projects.board(deps, actor),
      projects.activeProjects(deps, actor),
      projects.upcomingDeadlines(deps, actor),
      openFile(deps, actor, deliverable.fileId),
    ];
    refused.forEach((answer, index) => assert.deepEqual(answer, { ok: false, error: "forbidden" }, `call ${index}`));
  }
  assert.deepEqual({ events: count(t.db, "activity_event"), tasks: count(t.db, "task"), files: count(t.db, "file") }, before);

  // A member may do everything here except change the owner.
  const sam = addUser(t.db, "member", "Sam Helper");
  assert.deepEqual(projects.setProjectOwner(deps, sam, project.id, sam), { ok: false, error: "forbidden" });
  assert.equal(projects.moveTaskStatus(deps, sam, task.id, "doing").ok, true);
  assert.equal(unwrap(projects.projectOverview(deps, sam, project.id)).can.setOwner, false);
});
