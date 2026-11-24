// Task keys (decision 0008, section 1) against a real database and over real
// HTTP: tasks number from 1 in each project, to-dos are TODO-n, a key can be
// changed and the old one still finds the task, and search and quick add open
// a task from its key.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as projects from "../../src/projects/index.ts";
import * as todos from "../../src/todos/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let samId: Id;
let website: Id;
let wash: Id;
const problemOf = (res: Response) => new URL("http://x" + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  samId = t.db.prepare("select id from user where email = 'sam@example.com'").get()?.["id"] as Id;
  website = (await wonProject(t.services, mikeyId, { client: "Better Days Towing", title: "Better Days website" })).project.id;
  wash = (await wonProject(t.services, mikeyId, { client: "Better Days Wash", title: "Better Days Wash" })).project.id;
});
after(() => t.stop());

test("a project gets a key from its name, and its tasks number from 1", () => {
  assert.equal(t.services.projects.projects.keyOf(website), "BDW");
  assert.equal(t.services.projects.projects.keyOf(wash), "BDW2", "a key already taken gets a digit");
  const first = unwrap(projects.addTask(t.services.projects, mikeyId, website, { title: "Build the homepage" }));
  const second = unwrap(projects.addTask(t.services.projects, mikeyId, website, { title: "Pick the colours" }));
  const elsewhere = unwrap(projects.addTask(t.services.projects, mikeyId, wash, { title: "Price list" }));
  assert.equal(t.services.projects.tasks.row(first.id)?.ref, "BDW-1");
  assert.equal(t.services.projects.tasks.row(second.id)?.ref, "BDW-2");
  assert.equal(t.services.projects.tasks.row(elsewhere.id)?.ref, "BDW2-1", "each project counts its own");
  const todo = unwrap(todos.addTodo(t.services.todos, mikeyId, { title: "Call the printer" }));
  assert.match(t.services.projects.tasks.row(todo.id)?.ref ?? "", /^TODO-\d+$/);
});

test("pages show keys, and search and quick add open a task from its key", async () => {
  const homepage = t.db.prepare("select id from task where title = 'Build the homepage'").get()?.["id"] as string;
  assert.match(textOf(await mikey.page(`/projects/${website}/tasks`)), /BDW-1 Build the homepage/);
  assert.match(textOf(await mikey.page(`/tasks/${homepage}`)), /BDW-1/);
  assert.match(textOf(await mikey.page("/work")), /BDW-2 Pick the colours/);
  assert.match(textOf(await mikey.page("/todos")), /TODO-\d+ Call the printer/);
  for (const path of ["/search?q=bdw-1", "/add?text=BDW-1"]) {
    const res = await mikey.get(path);
    assert.equal(res.status, 303, path);
    assert.equal(res.headers.get("location"), `/tasks/${homepage}`, path);
  }
  assert.equal((await mikey.get("/search?q=BDW-99")).status, 200, "no such task: search as usual");
  assert.equal((await mikey.get("/add?text=BDW-1%20later")).status, 200, "more than a key is a new task");
});

test("changing a key: checked, recorded, and the old key still works", async () => {
  assert.deepEqual(projects.setProjectKey(t.services.projects, null, website, "SITE"), { ok: false, error: "forbidden" });
  assert.deepEqual(projects.setProjectKey(t.services.projects, samId, website, "bdw"), { ok: false, error: "unchanged" }, "anyone who may edit the project; the same key is no change");
  assert.match(problemOf(await mikey.post(`/projects/${website}/key`, { key: "todo" })), /TODO and INV are taken/);
  assert.match(problemOf(await mikey.post(`/projects/${website}/key`, { key: "b" })), /2 to 6 letters/);
  assert.match(problemOf(await mikey.post(`/projects/${website}/key`, { key: "BDW2" })), /Another project has that key/);
  const changed = await mikey.post(`/projects/${website}/key`, { key: "site" });
  assert.equal(new URL("http://x" + (changed.headers.get("location") ?? "")).searchParams.get("done"), "Its tasks are SITE-1, SITE-2 and on. Old keys still find them.");
  assert.equal(t.services.projects.projects.keyOf(website), "SITE");
  const event = t.db.prepare("select context from activity_event where action = 'project.key-changed'").get()?.["context"] as string;
  assert.deepEqual({ ...JSON.parse(event), projectId: undefined }, { projectId: undefined, from: "BDW", to: "SITE" });
  const homepage = t.db.prepare("select id from task where title = 'Build the homepage'").get()?.["id"] as string;
  assert.equal(t.services.projects.tasks.row(homepage as Id)?.ref, "SITE-1");
  assert.equal(projects.findTaskByRef(t.services.projects, mikeyId, "BDW-1"), homepage, "the old key still finds it");
  assert.match(problemOf(await mikey.post(`/projects/${wash}/key`, { key: "BDW" })), /Another project has that key, or had it before/, "an old key isn't handed out again");
  assert.equal(projects.findTaskByRef(t.services.projects, samId, "SITE-1"), homepage, "anyone who may see tasks");
  assert.equal(projects.findTaskByRef(t.services.projects, null, "SITE-1"), null);
});
