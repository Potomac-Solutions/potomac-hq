// The timeline (decision 0007, section 9) against a real database and over
// real HTTP: start dates on tasks, a project's timeline, and every project's.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { httpClient, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let mikeyId: Id;
let website: Id;
let homepage: Id;
const today = () => Temporal.Now.plainDateISO("America/New_York");
const day = (days: number) => today().add({ days }).toString();
const problemOf = (location: string | null) => new URL("http://x" + (location ?? "")).searchParams.get("problem") ?? "";
const startOf = (id: Id) => t.db.prepare("select start_on from task where id = ?").get(id)?.["start_on"];

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await mikey.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  website = (await wonProject(t.services, mikeyId, { client: "Better Days Towing", title: "Better Days website" })).project.id;
});
after(() => t.stop());

test("a task's start date: set on its page, kept by edits that don't send one, never after it's due", async () => {
  await mikey.submit(`/projects/${website}/tasks`, { title: "Build the homepage", startOn: day(2), dueOn: day(9) });
  homepage = t.db.prepare("select id from task where title = 'Build the homepage'").get()?.["id"] as Id;
  assert.equal(startOf(homepage), day(2));
  const page = textOf(await mikey.page(`/tasks/${homepage}`));
  assert.match(page, /Starts [A-Z][a-z]{2}, [A-Z][a-z]{2} \d+/);

  unwrap(projects.updateTask(t.services.projects, mikeyId, homepage, { title: "Build the homepage", dueOn: day(10) }));
  assert.equal(startOf(homepage), day(2), "an edit without a start keeps it");

  const refused = await mikey.post(`/tasks/${homepage}`, { title: "Build the homepage", startOn: day(12), dueOn: day(10) });
  assert.match(problemOf(refused.headers.get("location")), /can't start after it's due/);
  await mikey.submit(`/tasks/${homepage}`, { title: "Build the homepage", startOn: "", dueOn: day(10) });
  assert.equal(startOf(homepage), null, "cleared on the form");
  await mikey.submit(`/tasks/${homepage}`, { title: "Build the homepage", startOn: day(2), dueOn: day(9) });
});

test("a project's timeline: a group per phase with its span, bars for start-to-due, points for due dates and milestones", async () => {
  const deps = t.services.projects;
  const design = unwrap(projects.addPhase(deps, mikeyId, website, { name: "Design" }));
  unwrap(projects.addTask(deps, mikeyId, website, { title: "Pick the colours", phaseId: design.id, startOn: day(0), dueOn: day(3) }));
  unwrap(projects.addMilestone(deps, mikeyId, website, { name: "Client signs off the design", phaseId: design.id, dueOn: day(5) }));
  unwrap(projects.addTask(deps, mikeyId, website, { title: "Swap the truck photos", dueOn: day(-2) }));
  unwrap(projects.addTask(deps, mikeyId, website, { title: "Someday: a blog" }));

  const view = unwrap(projects.projectTimeline(deps, mikeyId, website));
  assert.equal(view.undated, 1);
  assert.deepEqual(view.groups.map((group) => group.label), ["Design", "No phase"]);
  const [designGroup, rest] = view.groups;
  assert.ok(designGroup?.bar, "a phase's bar spans its tasks and milestones");
  assert.match(designGroup.bar.when, / to /);
  const colours = designGroup.rows.find((row) => row.title === "Pick the colours");
  assert.equal(colours?.place.point, false);
  assert.equal(designGroup.rows.find((row) => row.kind === "milestone")?.place.point, true);
  const late = rest?.rows.find((row) => row.title === "Swap the truck photos");
  assert.equal(late?.place.point, true);
  assert.equal(late?.overdue, true);
  assert.ok(view.scale?.today !== null);

  const page = await mikey.page(`/projects/${website}/timeline`);
  assert.match(page, /<a href="\/projects\/[0-9a-f-]{36}\/timeline" aria-current="page">Timeline<\/a>/);
  assert.match(page, /class="tl-bar" data-state="task" style="left: [\d.]+%; width: [\d.]+%"/);
  assert.match(page, /class="tl-point" data-state="late" style="left: [\d.]+%"/);
  assert.match(page, /class="tl-today" style="left: [\d.]+%"><span>Today<\/span>/);
  assert.match(textOf(page), /Swap the truck photos Due [A-Z][a-z]{2} \d+\. To do\. Late/);
  assert.match(textOf(page), /1 task has no dates, so it isn't shown\./);
  assert.match(await mikey.page(`/projects/${website}`), /href="\/projects\/[0-9a-f-]{36}\/timeline">Timeline<\/a>/);
});

test("a repeat moves its start date with its due date", () => {
  const deps = t.services.projects;
  const weekly = unwrap(projects.addTask(deps, mikeyId, website, { title: "Weekly check-in", startOn: day(-1), dueOn: day(1) }));
  unwrap(projects.setTaskRepeat(deps, mikeyId, weekly.id, { every: "1", unit: "week", from: "due" }));
  unwrap(projects.moveTaskStatus(deps, mikeyId, weekly.id, "done"));
  const next = t.db.prepare("select start_on, due_on from task where previous_id = ?").get(weekly.id) as Record<string, unknown>;
  assert.deepEqual({ ...next }, { start_on: day(6), due_on: day(8) });
});

test("every active project on one timeline: start to target, or across its tasks, with milestones marked; demos left out", async () => {
  const deps = t.services.projects;
  const tailgate = (await wonProject(t.services, mikeyId, { client: "Tailgate Farms", title: "Tailgate shop" })).project;
  unwrap(projects.editProjectDetails(deps, mikeyId, tailgate.id, { name: "Tailgate shop", health: "on-track", startOn: day(-10), targetOn: day(30) }));
  await wonProject(t.services, mikeyId, { client: "Undated Diner", title: "Diner menu" });

  const view = unwrap(projects.projectsTimeline(deps, mikeyId));
  assert.equal(view.undated, 1, "the diner has no dates at all");
  const shop = view.rows.find((row) => row.title === "Tailgate shop");
  assert.match(shop?.when ?? "", /^Tailgate Farms\. [A-Z][a-z]{2} \d+ to [A-Z][a-z]{2} \d+$/);
  const site = view.rows.find((row) => row.title === "Better Days website");
  assert.ok(site, "drawn across its tasks' dates");
  assert.equal(site.marks.length, 1);
  assert.match(site.marks[0]?.title ?? "", /^Client signs off the design, Due /);

  const page = await mikey.page("/timeline");
  assert.match(page, /<a href="\/timeline" aria-current="page">Timeline<\/a>/);
  assert.match(page, /<a href="\/projects\/[0-9a-f-]{36}\/timeline">Tailgate shop<\/a>/);
  assert.match(page, /class="tl-mark" title="Client signs off the design, Due [^"]+" style="left: [\d.]+%"/);
  assert.match(textOf(page), /1 active project has no dates yet/);
  assert.equal((await httpClient(t.origin).get("/timeline")).status, 401, "signed out sees the sign-in page");
});
