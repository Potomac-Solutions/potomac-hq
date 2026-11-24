// Repeating tasks (decision 0007, section 7) against a real database and over
// real HTTP: finishing one, from the board, its page or My work, makes the next.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let mikeyId: Id;
let website: Id;
const today = () => Temporal.Now.plainDateISO("America/New_York");
const problemOf = (location: string | null) => new URL("http://x" + (location ?? "")).searchParams.get("problem") ?? "";
const rows = (title: string) => t.db.prepare("select * from task where title = ? order by rowid").all(title) as Record<string, unknown>[];
const labelsOf = (id: unknown) => (t.db.prepare("select l.name from task_label tl join label l on l.id = tl.label_id where tl.task_id = ? order by l.name").all(id as string) as { name: string }[]).map((row) => row.name);

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await mikey.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  website = (await wonProject(t.services, mikeyId, { client: "Better Days Towing", title: "Better Days website" })).project.id;
});
after(() => t.stop());

test("a weekly task: finishing it makes the next, with its fields, labels and fresh subtasks, linked both ways", async () => {
  const deps = t.services.projects;
  const due = today().subtract({ days: 2 });
  const report = unwrap(projects.addTask(deps, mikeyId, website, { title: "Send the weekly report", assigneeId: mikeyId, priority: "high", dueOn: due.toString(), estimate: "0.5", description: "Traffic and calls." }));
  const label = unwrap(projects.addLabel(deps, mikeyId, { name: "Reports", colour: "teal" }));
  unwrap(projects.setTaskLabels(deps, mikeyId, report.id, { labelIds: [label.id] }));
  unwrap(projects.addSubtask(deps, mikeyId, report.id, { title: "Pull the call log", dueOn: due.subtract({ days: 1 }).toString() }));

  const set = await mikey.submit(`/tasks/${report.id}/repeat`, { every: "1", unit: "week", from: "due" });
  assert.match(set.html, /It repeats now\./);
  assert.match(textOf(set.html), /Repeats Every week, from the due date/);
  assert.match(textOf(await mikey.page(`/projects/${website}/tasks`)), /Send the weekly report .*Repeats\./);

  const moved = await mikey.submit(`/tasks/${report.id}/status`, { to: "done", returnTo: `/tasks/${report.id}` });
  assert.match(moved.html, /Task moved\. It repeats, so the next one is due [A-Z][a-z]{2}, [A-Z][a-z]{2} \d+\./);
  const [first, second] = rows("Send the weekly report");
  assert.ok(first && second);
  assert.equal(first["status"], "done");
  assert.deepEqual(
    { status: second["status"], due: second["due_on"], who: second["assignee_id"], priority: second["priority"], estimate: second["estimate_minutes"], details: second["description"], previous: second["previous_id"], every: second["repeat_every"], unit: second["repeat_unit"] },
    { status: "todo", due: due.add({ weeks: 1 }).toString(), who: mikeyId, priority: "high", estimate: 30, details: "Traffic and calls.", previous: report.id, every: 1, unit: "week" },
  );
  assert.deepEqual(labelsOf(second["id"]), ["Reports"]);
  const subs = rows("Pull the call log");
  assert.equal(subs.length, 2);
  assert.equal(subs[1]?.["parent_id"], second["id"]);
  assert.equal(subs[1]?.["status"], "todo");
  assert.equal(subs[1]?.["due_on"], due.add({ weeks: 1 }).subtract({ days: 1 }).toString(), "moved as far as its parent");
  assert.ok(actions(t.db).includes("task.repeated"));

  assert.match(textOf(moved.html), /Next one Send the weekly report To do/);
  assert.match(textOf(await mikey.page(`/tasks/${second["id"]}`)), /Before this Send the weekly report Done/);

  // Done, reopened and done again: still one next.
  await mikey.post(`/tasks/${report.id}/status`, { to: "todo" });
  await mikey.post(`/tasks/${report.id}/status`, { to: "done" });
  assert.equal(rows("Send the weekly report").length, 2);
});

test("from the day it's done; stopping; subtasks and bad numbers refused", async () => {
  const deps = t.services.projects;
  const backup = unwrap(projects.addTask(deps, mikeyId, website, { title: "Check the backups", dueOn: today().subtract({ days: 30 }).toString() }));
  await mikey.post(`/tasks/${backup.id}/repeat`, { every: "10", unit: "day", from: "done" });
  await mikey.post(`/tasks/${backup.id}/status`, { to: "done" });
  assert.equal(rows("Check the backups")[1]?.["due_on"], today().add({ days: 10 }).toString());

  const next = rows("Check the backups")[1]?.["id"] as Id;
  const stopped = await mikey.submit(`/tasks/${next}/repeat/stop`, {});
  assert.match(stopped.html, /It no longer repeats\./);
  await mikey.post(`/tasks/${next}/status`, { to: "done" });
  assert.equal(rows("Check the backups").length, 2, "no third once it stopped");

  assert.match(problemOf((await mikey.post(`/tasks/${backup.id}/repeat`, { every: "0", unit: "day" })).headers.get("location")), /1 to 365/);
  const sub = rows("Pull the call log")[0]?.["id"] as Id;
  assert.match(problemOf((await mikey.post(`/tasks/${sub}/repeat`, { every: "1", unit: "week" })).headers.get("location")), /repeats with its parent/);
  assert.doesNotMatch(await mikey.page(`/tasks/${sub}`), /Make it repeat/);
});

test("a to-do from quick add repeats when ticked off on My work, at the same client, keeping todo events", async () => {
  await mikey.submit("/add", { text: "Renew the domain +better-days-towing every year today", skip: "" });
  const [todo] = rows("Renew the domain");
  assert.ok(todo);
  assert.equal(todo["repeat_unit"], "year");
  await mikey.post(`/todos/${todo["id"]}/done`, { returnTo: "/todos" });
  const [, next] = rows("Renew the domain");
  assert.ok(next, "the next one was made");
  assert.equal(next["project_id"], null);
  assert.equal(next["organization_id"], todo["organization_id"]);
  assert.equal(next["due_on"], today().add({ years: 1 }).toString());
  assert.ok(actions(t.db).includes("todo.done"));
  assert.match(await mikey.page("/todos"), /Renew the domain/);
});
