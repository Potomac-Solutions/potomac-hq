// Importing tasks from Trello and Todoist (decision 0007, section 13) against
// a real database and over real HTTP: upload, preview, then all at once.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let website: Id;
const bytes = (text: string) => new TextEncoder().encode(text);
const problemOf = (res: Response) => new URL("http://x" + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const upload = (client: Client, source: string, name: string, text: string, projectId = website) => client.upload(`/projects/${projectId}/import`, { source }, { field: "file", name, bytes: bytes(text), type: name.endsWith(".json") ? "application/json" : "text/csv" });
const task = (title: string) => t.db.prepare("select * from task where title = ?").get(title) as Record<string, unknown> | undefined;
const labelsOf = (id: unknown) => (t.db.prepare("select l.name from task_label tl join label l on l.id = tl.label_id where tl.task_id = ? order by l.name").all(id as string) as { name: string }[]).map((row) => row.name);

const TRELLO = JSON.stringify({
  name: "Better Days board",
  lists: [{ id: "l1", name: "To do", closed: false }, { id: "l2", name: "In progress", closed: false }, { id: "l3", name: "Done", closed: false }],
  labels: [{ id: "g", name: "website", color: "green" }, { id: "p", name: "Photos", color: "purple" }],
  cards: [
    { id: "c1", name: "Build the homepage", desc: "Use the new logo.", idList: "l2", closed: false, due: "2026-12-04T22:00:00.000Z", idLabels: ["g", "p"] },
    { id: "c2", name: "Pick the colours", idList: "l3", closed: false, idLabels: [] },
    { id: "c3", name: "Old idea", idList: "l1", closed: true },
  ],
  checklists: [{ id: "k", idCard: "c1", checkItems: [{ name: "Hero", state: "complete" }, { name: "Services", state: "incomplete" }] }],
});

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  website = (await wonProject(t.services, mikeyId, { client: "Better Days Towing", title: "Better Days website" })).project.id;
  unwrap(projects.addLabel(t.services.projects, mikeyId, { name: "Website", colour: "blue" }));
});
after(() => t.stop());

test("a Trello board: previewed first, then every task, subtask and label at once", async () => {
  assert.match(await mikey.page(`/projects/${website}/tasks`), /Import tasks from Trello or Todoist/);
  const sent = await upload(mikey, "trello", "board.json", TRELLO);
  const location = sent.headers.get("location") ?? "";
  assert.match(location, /^\/imports\/[0-9a-f-]{36}\?done=/);
  assert.equal(task("Build the homepage"), undefined, "nothing made yet");
  const importId = /\/imports\/([0-9a-f-]{36})/.exec(location)?.[1] as Id;

  const preview = textOf(await mikey.page(`/imports/${importId}`));
  assert.match(preview, /Import from Trello: Better Days board/);
  assert.match(preview, /2 tasks and 2 subtasks into Better Days website/);
  assert.match(preview, /1 working on, 1 done\./);
  assert.match(preview, /Labels: Photos \(new\), website\./, "Website is already in HQ, whatever its capitals");
  assert.match(preview, /Left out: 1 archived card\./);
  assert.match(preview, /Build the homepage In progress Working on [A-Z][a-z]{2}, [A-Z][a-z]{2} 4.* website, Photos 2/);
  assert.equal((await sam.get(`/imports/${importId}`)).status, 404, "someone else's preview isn't there for anyone else");
  assert.equal((await sam.post(`/imports/${importId}`, {})).headers.get("location")?.startsWith("/projects?problem="), true, "nor can they say yes to it");

  const done = await mikey.submit(`/imports/${importId}`, {});
  assert.match(done.location, new RegExp(`^/projects/${website}/tasks\\?done=`));
  assert.match(done.html, /Imported 2 tasks and 2 subtasks, with 1 new label\./);
  const homepage = task("Build the homepage");
  assert.deepEqual({ status: homepage?.["status"], due: homepage?.["due_on"], details: homepage?.["description"], by: homepage?.["created_by"], who: homepage?.["assignee_id"] }, { status: "doing", due: "2026-12-04", details: "Use the new logo.", by: mikeyId, who: null });
  assert.deepEqual(labelsOf(homepage?.["id"]), ["Photos", "Website"]);
  assert.equal(t.db.prepare("select colour from label where name = 'Photos'").get()?.["colour"], "violet");
  assert.equal(task("Hero")?.["parent_id"], homepage?.["id"]);
  assert.equal(task("Hero")?.["status"], "done");
  assert.equal(task("Pick the colours")?.["status"], "done");
  assert.notEqual(task("Pick the colours")?.["done_at"], null);
  assert.equal(task("Old idea"), undefined);
  assert.ok(actions(t.db).includes("project.tasks-imported"));
  assert.equal((await mikey.get(`/imports/${importId}`)).status, 404, "used up");
});

test("a Todoist export, with priorities, repeats and @labels; cancelling adds nothing", async () => {
  const csv = "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE\ntask,Renew the domain @admin,,1,1,,,every year,en,\ntask,Order the yard sign,,3,1,,,,en,\ntask,Measure the wall,,4,2,,,,en,\n";
  const cancelled = await upload(mikey, "todoist", "project.csv", csv);
  const first = /\/imports\/([0-9a-f-]{36})/.exec(cancelled.headers.get("location") ?? "")?.[1] as Id;
  const gone = await mikey.submit(`/imports/${first}/cancel`, {});
  assert.match(gone.html, /Import cancelled\. Nothing was added\./);
  assert.equal(task("Renew the domain"), undefined);

  const again = await upload(mikey, "todoist", "project.csv", csv);
  const id = /\/imports\/([0-9a-f-]{36})/.exec(again.headers.get("location") ?? "")?.[1] as Id;
  assert.match(textOf(await mikey.page(`/imports/${id}`)), /Renew the domain Urgent priority\. Every year, from the due date\./);
  await mikey.submit(`/imports/${id}`, {});
  const domain = task("Renew the domain");
  assert.deepEqual({ priority: domain?.["priority"], unit: domain?.["repeat_unit"] }, { priority: "urgent", unit: "year" });
  assert.deepEqual(labelsOf(domain?.["id"]), ["admin"]);
  assert.equal(task("Measure the wall")?.["parent_id"], task("Order the yard sign")?.["id"]);
});

test("the wrong file, an empty one, or a closed project, is explained and saves nothing", async () => {
  assert.match(problemOf(await upload(mikey, "trello", "board.json", "TYPE,CONTENT\ntask,x")), /isn't a Trello board's JSON export/);
  assert.match(problemOf(await upload(mikey, "todoist", "tasks.csv", "{\"cards\":[]}")), /isn't a Todoist CSV export/);
  assert.match(problemOf(await upload(mikey, "todoist", "tasks.csv", "")), /Choose a file|empty/);
  assert.match(problemOf(await upload(mikey, "asana", "x.csv", "a")), /Trello or Todoist/);
  const closed = (await wonProject(t.services, mikeyId, { client: "Tailgate Farms", title: "Tailgate shop" })).project.id;
  unwrap(projects.setProjectStatus(t.services.projects, mikeyId, closed, "completed"));
  assert.match(problemOf(await upload(mikey, "trello", "board.json", TRELLO, closed)), /closed/);
  assert.equal(t.db.prepare("select count(*) as n from task_import").get()?.["n"], 0);
});
