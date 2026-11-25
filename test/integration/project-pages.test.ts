// v0.3 over real HTTP: the project pages, the task list and boards, uploads
// and downloads, notes, and the theme.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Id } from "../../src/shared/index.ts";
import { httpClient, idIn, PDF, signIn, testApp, textOf, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let projectId = "";
let clientId = "";
let opportunityId = "";
let taskId = "";
let fileId = "";

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const made = await wonProject(t.services, mikey);
  projectId = made.project.id;
  clientId = made.client.id;
  opportunityId = made.opportunity.id;
});
after(() => t.stop());

test("the projects list and a project's overview", async () => {
  const list = await admin.page("/projects");
  assert.match(list, /<h1>Projects<\/h1>/);
  assert.match(list, new RegExp(`<a href="/projects/${projectId}">Bakery website</a>`));
  assert.match(list, /None set/);
  assert.match(await admin.page("/projects?status=cancelled"), /No projects with that status/);

  const page = await admin.page(`/projects/${projectId}`);
  assert.match(page, /<h1>Bakery website<\/h1>/);
  assert.match(page, /On track/);
  assert.match(page, /No milestones yet/);
  assert.match(page, /No deliverables yet/);
  assert.match(page, /Mikey Nichols started a project/);

  assert.equal((await admin.get("/projects/not-an-id")).status, 404);
  assert.equal((await admin.get("/projects/00000000-0000-4000-8000-000000000000")).status, 404);
});

test("details, phases and milestones are changed through the page's forms", async () => {
  const saved = await admin.submit(`/projects/${projectId}`, { name: "Bakery site", description: "Menu first.", health: "at-risk", startOn: "2026-11-20", targetOn: "2027-01-15" });
  assert.match(saved.html, /Project saved\./);
  assert.match(saved.html, /<h1>Bakery site<\/h1>/);
  assert.match(saved.html, /At risk/);

  const bad = await admin.submit(`/projects/${projectId}`, { name: "Bakery site", health: "at-risk", startOn: "2027-02-01", targetOn: "2027-01-15" });
  assert.match(bad.html, /The target date is before the start date\./);

  assert.match((await admin.submit(`/projects/${projectId}/phases`, { name: "Design" })).html, /Phase added\./);
  const added = await admin.submit(`/projects/${projectId}/milestones`, { name: "Design signed off", dueOn: "2099-12-05" });
  assert.match(added.location, new RegExp(`^/projects/${projectId}\\?done=.*#plan$`));
  assert.match(added.html, /Milestone added\./);
  assert.match(textOf(added.html), /Next milestone Design signed off ?, due Sat, Dec 5, 2099, in [\d,]+ days/);
  assert.match(added.html, /0 of 1 milestones done\./);

  const milestoneId = /action="\/milestones\/([0-9a-f-]{36})\/done"/.exec(added.html)?.[1] ?? "";
  const done = await admin.submit(`/milestones/${milestoneId}/done`, { projectId, done: "1" });
  assert.match(done.html, /1 of 1 milestones done\./);
  assert.match(done.html, /Reopen/);
  const twice = await admin.submit(`/milestones/${milestoneId}/done`, { projectId, done: "1" });
  assert.match(twice.html, /That milestone is already done\./);
});

test("tasks: the list, a task's page, and both boards", async () => {
  assert.match(await admin.page(`/projects/${projectId}/tasks`), /No tasks yet/);
  const added = await admin.submit(`/projects/${projectId}/tasks`, { title: "Draft the menu page", priority: "high", dueOn: "2020-01-01", estimate: "1.5", assigneeId: "", description: "" });
  assert.match(added.html, /Task added\./);
  assert.match(added.html, /Draft the menu page/);
  assert.match(added.html, /Overdue/);
  taskId = /href="\/tasks\/([0-9a-f-]{36})"/.exec(added.html)?.[1] ?? "";

  const task = await admin.page(`/tasks/${taskId}`);
  assert.match(task, /<h1>Draft the menu page<\/h1>/);
  assert.match(task, /1\.5 hours/);
  const edited = await admin.submit(`/tasks/${taskId}`, { title: "Draft the menu", priority: "urgent", dueOn: "", estimate: "two" });
  assert.match(edited.html, /Enter the estimate in hours, like 1\.5\./);

  const board = await admin.page("/board");
  assert.match(board, /<h1>Board<\/h1>/);
  assert.match(board, /Draft the menu page/);
  assert.match(board, new RegExp(`id="move-${taskId}"`));

  // A move goes back where it came from, and nowhere else.
  const moved = await admin.submit(`/tasks/${taskId}/status`, { to: "doing", returnTo: `/projects/${projectId}/board` });
  assert.match(moved.location, new RegExp(`^/projects/${projectId}/board\\?(undo=[0-9a-f-]+&)?done=`));
  assert.match(moved.html, /Task moved\./);
  const elsewhere = await admin.post(`/tasks/${taskId}/status`, { to: "blocked", returnTo: "https://example.com/" });
  assert.match(elsewhere.headers.get("location") ?? "", new RegExp(`^/tasks/${taskId}\\?(undo=[0-9a-f-]+&)?done=`));
  assert.match(await admin.page("/board?mine=1"), /Nothing assigned to you/);
});

test("a deliverable is uploaded, downloaded only by someone signed in, and shared", async () => {
  const refused = await admin.upload(`/projects/${projectId}/deliverables`, { title: "Design" }, { field: "file", name: "design.html", bytes: PDF });
  assert.match((await admin.follow(refused, "upload")).html, /That kind of file can’t be uploaded\./);

  const uploaded = await admin.follow(await admin.upload(`/projects/${projectId}/deliverables`, { title: "Home page design", description: "First pass." }, { field: "file", name: "design.pdf", bytes: PDF, type: "text/html" }), "upload");
  assert.match(uploaded.html, /Deliverable added\./);
  assert.match(uploaded.html, /Home page design/);
  assert.match(uploaded.html, /Draft, not shared/);
  fileId = /href="\/files\/([0-9a-f-]{36})"/.exec(uploaded.html)?.[1] ?? "";

  const download = await admin.get(`/files/${fileId}`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/pdf", "the type comes from the name, not from what the browser claimed");
  assert.match(download.headers.get("content-disposition") ?? "", /^attachment; filename="design\.pdf"/);
  assert.equal(download.headers.get("cache-control"), "private, no-store");
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual([...new Uint8Array(await download.arrayBuffer())], [...PDF]);

  const stranger = httpClient(t.origin);
  assert.equal((await stranger.get(`/files/${fileId}`)).status, 404, "signed out, the file does not exist");
  assert.equal((await stranger.get(`/portal/files/${fileId}`)).status, 404);
  assert.equal((await admin.get("/files/not-an-id")).status, 404);
  assert.equal((await admin.get("/files/00000000-0000-4000-8000-000000000000")).status, 404);

  const deliverableId = /action="\/deliverables\/([0-9a-f-]{36})\/share"/.exec(uploaded.html)?.[1] ?? "";
  const shared = await admin.submit(`/deliverables/${deliverableId}/share`, { projectId });
  assert.match(shared.html, /Shared, waiting for the client/);
  assert.match(shared.html, /Stop sharing/);

  // Files are accepted only at the addresses made for them, and only from this site.
  assert.equal((await admin.upload("/clients", { name: "x" }, { field: "file", name: "a.pdf", bytes: PDF })).status, 415);
  assert.equal((await admin.upload(`/projects/${projectId}/deliverables`, { title: "x" }, { field: "file", name: "a.pdf", bytes: PDF }, { origin: "https://evil.example" })).status, 403);
  const big = await fetch(`${t.origin}/projects/${projectId}/deliverables`, { method: "POST", headers: { origin: t.origin, "content-type": "multipart/form-data; boundary=x", "content-length": String(30 * 1024 * 1024) }, body: "x", redirect: "manual" }).catch(() => null);
  assert.ok(big === null || big.status === 413, "an upload that says it is over the limit is refused before it is read");
});

test("notes on a project, a client and an opportunity", async () => {
  const onProject = await admin.submit("/notes", { recordType: "project", recordId: projectId, body: "Called Ann. Menu first." });
  assert.match(onProject.location, new RegExp(`^/projects/${projectId}\\?done=.*#notes$`));
  assert.match(onProject.html, /Note added\./);
  assert.match(onProject.html, /Called Ann\. Menu first\./);
  assert.match(onProject.html, /Mikey Nichols wrote a note/);

  assert.match((await admin.submit("/notes", { recordType: "client-organization", recordId: clientId, body: "Closed on Mondays." })).html, /Closed on Mondays\./);
  assert.match((await admin.submit("/notes", { recordType: "opportunity", recordId: opportunityId, body: "Budget is tight." })).html, /Budget is tight\./);
  assert.match((await admin.submit("/notes", { recordType: "project", recordId: projectId, body: "   " })).html, /Write the note first\./);
  const nowhere = await admin.post("/notes", { recordType: "user", recordId: "x", body: "hello" });
  assert.match(nowhere.headers.get("location") ?? "", /^\/\?problem=/);
});

test("the dashboard shows active projects and deadlines", async () => {
  await admin.submit(`/projects/${projectId}/milestones`, { name: "Launch", dueOn: Temporal.Now.plainDateISO("America/New_York").add({ days: 3 }).toString() });
  const dashboard = await admin.page("/");
  assert.match(dashboard, /Active projects: 1/);
  assert.match(dashboard, /Upcoming deadlines/);
  assert.match(dashboard, /Milestone: <a href="\/projects\/[0-9a-f-]{36}">Launch<\/a>/);
  assert.match(dashboard, /Task: <a href="\/tasks\/[0-9a-f-]{36}">Draft the menu page<\/a>/);
});

test("the theme: the device decides until a person chooses", async () => {
  const dark = '<link rel="stylesheet" href="/assets/theme-dark.css">';
  const system = '<link rel="stylesheet" href="/assets/theme-dark.css" media="(prefers-color-scheme: dark)">';
  assert.ok((await admin.page("/settings")).includes(system));
  const saved = await admin.submit("/settings/theme", { theme: "dark" });
  assert.match(saved.html, /Theme saved\./);
  assert.ok(saved.html.includes(dark));
  assert.ok((await admin.page("/projects")).includes(dark), "every page follows the choice");
  await admin.submit("/settings/theme", { theme: "light" });
  assert.ok(!(await admin.page("/")).includes("theme-dark.css"));
  assert.match((await admin.submit("/settings/theme", { theme: "neon" })).html, /Choose a theme from the list\./);
  assert.ok((await httpClient(t.origin).page("/")).includes(system), "signed out, the device decides");

  const css = await (await admin.get("/assets/theme-dark.css")).text();
  assert.match(css, /^:root \{\s+color-scheme: dark;/);
  assert.match(css, /--background: #101820;/);
  assert.ok(!css.includes(".dark"));
});

test("a member sees the project but not the owner form, and a stranger sees nothing", async () => {
  const member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
  const page = await member.page(`/projects/${projectId}`);
  assert.match(page, /<h1>Bakery site<\/h1>/);
  assert.doesNotMatch(page, /Change owner/);
  assert.match(page, /Add a milestone/);
  const refused = await member.submit(`/projects/${projectId}/owner`, { ownerId: idIn(`/x/${projectId}`) });
  assert.match(refused.html, /You don’t have permission to do that\./);

  const stranger = httpClient(t.origin);
  for (const path of ["/projects", `/projects/${projectId}`, `/projects/${projectId}/tasks`, `/projects/${projectId}/board`, "/board", `/tasks/${taskId}`, "/settings"]) {
    const res = await stranger.get(path);
    assert.equal(res.status, 401, path);
    assert.doesNotMatch(await res.text(), /Bakery/, path);
  }
  const post = await stranger.post(`/tasks/${taskId}/status`, { to: "done" });
  assert.match(new URL(t.origin + (post.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /You don’t have permission/);
});
