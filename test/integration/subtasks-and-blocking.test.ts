// Subtasks and blocking (decision 0007, section 5) against a real database
// and over real HTTP.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let mikeyId: Id;
let website: Id;
let homepage: Id;
let photos: Id;
let shop: Id;
const problemOf = (location: string | null) => new URL("http://x" + (location ?? "")).searchParams.get("problem") ?? "";
const idOf = (title: string) => t.db.prepare("select id from task where title = ?").get(title)?.["id"] as Id;

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await mikey.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const deps = t.services.projects;
  website = (await wonProject(t.services, mikeyId, { client: "Better Days Towing", title: "Better Days website" })).project.id;
  const tailgate = (await wonProject(t.services, mikeyId, { client: "Tailgate Farms", title: "Tailgate shop" })).project.id;
  homepage = unwrap(projects.addTask(deps, mikeyId, website, { title: "Build the homepage" })).id;
  photos = unwrap(projects.addTask(deps, mikeyId, website, { title: "Get the truck photos" })).id;
  shop = unwrap(projects.addTask(deps, mikeyId, tailgate, { title: "Set up the shop" })).id;
});
after(() => t.stop());

test("subtasks: added from the parent's page, in its project, counted on the parent, one level deep", async () => {
  const added = await mikey.submit(`/tasks/${homepage}/subtasks`, { title: "Write the hero copy", assigneeId: mikeyId, dueOn: "" });
  assert.match(added.html, /Subtask added\./);
  await mikey.submit(`/tasks/${homepage}/subtasks`, { title: "Pick the hero photo", assigneeId: "", dueOn: "" });
  const copy = idOf("Write the hero copy");
  const row = t.db.prepare("select project_id, parent_id, assignee_id from task where id = ?").get(copy) as Record<string, unknown>;
  assert.deepEqual({ ...row }, { project_id: website, parent_id: homepage, assignee_id: mikeyId });
  assert.ok(actions(t.db).includes("task.added"));

  await mikey.post(`/tasks/${copy}/status`, { to: "done" });
  const parent = await mikey.page(`/tasks/${homepage}`);
  assert.match(textOf(parent), /Subtasks 1 of 2 done/);
  assert.match(parent, /<a href="\/tasks\/[0-9a-f-]{36}">Write the hero copy<\/a>/);
  assert.match(parent, /Finishing this task doesn’t finish its subtasks/);
  assert.match(textOf(await mikey.page(`/projects/${website}/tasks`)), /Build the homepage Subtasks 1 of 2 done\./);
  assert.match(textOf(await mikey.page(`/projects/${website}/board`)), /Subtasks 1 of 2 done/);

  const child = await mikey.page(`/tasks/${copy}`);
  assert.match(textOf(child), /Subtask of Build the homepage/);
  assert.doesNotMatch(child, /Add subtask/, "a subtask takes no subtasks of its own");
  const refused = await mikey.post(`/tasks/${copy}/subtasks`, { title: "Too deep" });
  assert.match(problemOf(refused.headers.get("location")), /can’t have subtasks of its own|can't have subtasks of its own/);

  await mikey.submit("/todos", { title: "Renew the Netlify card" });
  const todo = idOf("Renew the Netlify card");
  assert.match(problemOf((await mikey.post(`/tasks/${todo}/subtasks`, { title: "Find the card" })).headers.get("location")), /A to-do can't have them/);

  await mikey.post(`/tasks/${homepage}/status`, { to: "done" });
  assert.equal(t.db.prepare("select status from task where title = 'Pick the hero photo'").get()?.["status"], "todo", "finishing the parent leaves its subtasks");
  await mikey.post(`/tasks/${homepage}/status`, { to: "todo" });
});

test("blocking: across projects and to-dos, never itself or in a circle; moving to working on warns but goes", async () => {
  await mikey.submit("/todos", { title: "Ask Dale for the photos" });
  const ask = idOf("Ask Dale for the photos");
  const waits = await mikey.submit(`/tasks/${homepage}/blockers`, { blockerId: photos });
  assert.match(waits.html, /It now waits on that task\./);
  await mikey.submit(`/tasks/${photos}/blockers`, { blockerId: ask });
  await mikey.submit(`/tasks/${shop}/blockers`, { blockerId: homepage });

  const page = await mikey.page(`/tasks/${homepage}`);
  const said = textOf(page);
  assert.match(said, /Waits on BDW-2 Get the truck photos Better Days website To do/);
  assert.match(said, /Holds up TS-1 Set up the shop Tailgate shop To do/);
  assert.match(said, /Waiting on 1 unfinished task/);
  const choices = /<select id="blocker"[\s\S]*?<\/select>/.exec(page)?.[0] ?? "";
  assert.match(choices, /<optgroup label="Better Days website">[\s\S]*<optgroup label="To-dos">[\s\S]*Ask Dale for the photos/, "to-dos come last");
  assert.doesNotMatch(choices, /<optgroup label="Tailgate shop">/, "its one task waits on this one, so the group is empty");
  assert.doesNotMatch(choices, /Set up the shop/, "it waits on this one, so it can't be a blocker");
  assert.doesNotMatch(choices, /Get the truck photos/, "already waited on");
  assert.doesNotMatch(choices, />Build the homepage</, "not itself");

  assert.match(problemOf((await mikey.post(`/tasks/${ask}/blockers`, { blockerId: shop })).headers.get("location")), /already waits on this one/);
  assert.match(problemOf((await mikey.post(`/tasks/${homepage}/blockers`, { blockerId: homepage })).headers.get("location")), /can't wait on itself/);
  assert.match(problemOf((await mikey.post(`/tasks/${homepage}/blockers`, { blockerId: photos })).headers.get("location")), /already waits on that task/);

  const moved = await mikey.submit(`/tasks/${homepage}/status`, { to: "doing", returnTo: `/tasks/${homepage}` });
  assert.match(moved.html, /Task moved\. It is still waiting on “Get the truck photos”\./);
  assert.equal(t.db.prepare("select status from task where id = ?").get(homepage)?.["status"], "doing");
  assert.match(textOf(await mikey.page(`/projects/${website}/board`)), /Waiting on 1/);

  await mikey.post(`/tasks/${photos}/status`, { to: "done" });
  assert.doesNotMatch(textOf(await mikey.page(`/tasks/${homepage}`)), /Waiting on 1 unfinished task/, "a finished blocker no longer counts");
  const stopped = await mikey.submit(`/tasks/${homepage}/blockers/remove`, { blockerId: photos });
  assert.match(stopped.html, /It no longer waits on that task\./);
  assert.match(textOf(stopped.html), /Waits on Nothing\. It can start whenever\./);
  for (const action of ["task.blocked", "task.unblocked"]) assert.ok(actions(t.db).includes(action), action);
});
