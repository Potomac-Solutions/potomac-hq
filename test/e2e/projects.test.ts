// v0.3 in a real browser: a project's plan, tasks and deliverables, the board
// with drag and drop, notes, and both themes. Every screen is checked by axe.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, type Browser, type BrowserContext } from "playwright";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { PDF, testApp, wonProject, type TestApp } from "../support/harness.ts";

let t: TestApp;
let browser: Browser;
let signedIn: BrowserContext;
let projectId = "";
let scratch = "";
// Runs in the page: the theme's background colour as the browser resolved it.
const BACKGROUND = "getComputedStyle(document.documentElement).getPropertyValue('--background').trim()";

before(async () => {
  t = await testApp();
  browser = await chromium.launch();
  scratch = mkdtempSync(join(tmpdir(), "hq-e2e-files-"));
});
after(async () => {
  await browser?.close();
  await t.stop();
  rmSync(scratch, { recursive: true, force: true });
});

test("run a project from its pages and the board", async () => {
  signedIn = await browser.newContext();
  const page = await signedIn.newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  projectId = (await wonProject(t.services, mikey)).project.id;

  // The dashboard's new panels, then the projects list from the navigation.
  await page.goto(t.origin + "/");
  await page.getByRole("heading", { name: "Active projects: 1" }).waitFor();
  await assertAccessible(page, "the dashboard with projects");
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/projects");
  await assertAccessible(page, "the projects list");
  await page.getByRole("link", { name: "Bakery website" }).click();
  await page.waitForURL((url) => url.pathname === `/projects/${projectId}`);
  await assertAccessible(page, "an empty project");

  // Details.
  await page.getByText("Edit details").click();
  await page.getByLabel("How it is going").selectOption("at-risk");
  await page.getByLabel("Target date").fill("2027-01-15");
  await page.getByRole("button", { name: "Save project" }).click();
  await page.getByText("Project saved.").waitFor();
  assert.match(await text(page), /How it is going ?At risk/);

  // The plan.
  await page.getByText("Add a phase").click();
  await page.getByLabel("Phase name").fill("Design");
  await page.getByRole("button", { name: "Add phase" }).click();
  await page.getByText("Phase added.").waitFor();
  await page.getByText("Add a milestone").click();
  await page.getByLabel("Milestone", { exact: true }).fill("Design signed off");
  await page.getByLabel("Due").fill("2099-12-05");
  await page.getByLabel("Phase", { exact: true }).selectOption({ label: "Design" });
  await page.getByRole("button", { name: "Add milestone" }).click();
  await page.getByText("Milestone added.").waitFor();
  assert.match(await text(page), /Next milestone ?Design signed off ?, due Sat, Dec 5, 2099, in [\d,]+ days/);
  await page.getByRole("button", { name: "Mark done: Design signed off" }).click();
  await page.getByText("1 of 1 milestones done.").waitFor();

  // A deliverable: upload, download, share.
  const file = join(scratch, "home-page.pdf");
  writeFileSync(file, PDF);
  await page.getByText("Add a deliverable").click();
  await page.getByLabel("Title").fill("Home page design");
  await page.getByLabel("File").setInputFiles(file);
  await page.getByRole("button", { name: "Upload deliverable" }).click();
  await page.getByText("Deliverable added.").waitFor();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "home-page.pdf" }).click()]);
  assert.equal(download.suggestedFilename(), "home-page.pdf");
  await page.getByRole("button", { name: "Share with the client: Home page design" }).click();
  await page.getByText("Shared, waiting for the client").waitFor();

  // A note.
  await page.getByLabel("Add a note").fill("Called Ann. She wants the menu first.");
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByText("Note added.").waitFor();
  assert.match(await text(page), /Called Ann\. She wants the menu first\. Mikey Nichols,/);
  await assertAccessible(page, "a full project");

  // Tasks.
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await page.waitForURL((url) => url.pathname.endsWith("/tasks"));
  await assertAccessible(page, "an empty task list");
  for (const title of ["Draft the menu page", "Set up hosting"]) {
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Who").selectOption({ label: "Mikey Nichols" });
    await page.getByRole("button", { name: "Add task" }).click();
    await page.getByText("Task added.").waitFor();
  }
  await assertAccessible(page, "a task list");
  await page.getByRole("link", { name: "Set up hosting" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/tasks/"));
  await assertAccessible(page, "a task");
  await page.getByLabel("Priority").selectOption("urgent");
  await page.getByRole("button", { name: "Save task" }).click();
  await page.getByText("Task saved.").waitFor();

  // The board: drag one card, move the other with its form.
  // The board is reached from Projects too, and has its own place in the sidebar.
  const main = page.getByRole("navigation", { name: "Main" });
  await main.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("link", { name: "Open the board" }).click();
  await page.waitForURL((url) => url.pathname === "/board");
  assert.equal(await main.getByRole("link", { name: "Board", exact: true }).getAttribute("aria-current"), "page");
  await assertAccessible(page, "the board");
  const column = (name: string) => page.locator("section.board-column", { has: page.getByRole("heading", { name: new RegExp(`^${name}`) }) });
  assert.equal(await column("To do").locator(".board-card").count(), 2);
  await page.locator(".board-card", { hasText: "Set up hosting" }).dragTo(column("Working on"));
  await page.getByText("Task moved.").waitFor();
  assert.match(await text(page, "section.board-column:nth-of-type(2)"), /Set up hosting/);
  await page.getByLabel("Move Draft the menu page to").selectOption("done");
  await page.getByRole("button", { name: "Move: Draft the menu page" }).click();
  await page.getByText("Task moved.").waitFor();
  assert.equal(await column("Done").locator(".board-card").count(), 1);
  assert.equal(await column("To do").locator(".board-card").count(), 0);

  // The project's own board, and only my tasks.
  await page.goto(`${t.origin}/projects/${projectId}/board`);
  await assertAccessible(page, "a project's board");
  await page.getByRole("link", { name: "Show only mine" }).click();
  await page.waitForURL((url) => url.search === "?mine=1");
  assert.equal(await page.locator(".board-card").count(), 2);

  assert.deepEqual(problems, []);
  await page.close();
});

test("dark mode: chosen in Settings, and every screen still passes", async () => {
  const page = await signedIn.newPage();
  await page.goto(t.origin + "/settings");
  await page.getByLabel("Colours").selectOption("dark");
  await page.getByRole("button", { name: "Save theme" }).click();
  await page.getByText("Theme saved.").waitFor();
  assert.equal(await page.evaluate(BACKGROUND), "#101820");
  for (const path of ["/settings", "/", "/pipeline", "/clients", "/projects", `/projects/${projectId}`, `/projects/${projectId}/tasks`, `/projects/${projectId}/timeline`, "/board", "/timeline", "/labels", "/work", "/notices", "/calendar-feed", "/webhooks", "/add?text=Proof%20%2Bnowhere%20tomorrow%20*website"]) {
    await page.goto(t.origin + path);
    await assertAccessible(page, `${path} in dark mode`);
  }
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Colours").selectOption("system");
  await page.getByRole("button", { name: "Save theme" }).click();
  await page.getByText("Theme saved.").waitFor();
  assert.equal(await page.evaluate(BACKGROUND), "#ffffff");
  await page.close();

  // "Match my device" follows a device set to dark.
  const state = await signedIn.storageState();
  const dark = await browser.newContext({ colorScheme: "dark", storageState: state });
  const darkPage = await dark.newPage();
  await darkPage.goto(t.origin + "/");
  assert.equal(await darkPage.evaluate(BACKGROUND), "#101820");
  await dark.close();
});

test("quick add: N goes to the box, the line is checked, then added", async () => {
  const page = await signedIn.newPage();
  const problems = watch(page);
  await page.goto(t.origin + "/today");
  await page.locator("h1").click();
  await page.keyboard.press("n");
  assert.equal(await page.evaluate("document.activeElement && document.activeElement.id"), "hq-quick-text");
  await page.keyboard.type("Swap the truck photos *photos tomorrow");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/add\?text=/);
  await page.getByText("New label photos").waitFor();
  await assertAccessible(page, "quick add preview");
  await page.getByRole("button", { name: "Add it" }).click();
  await page.getByText("Added.").waitFor();
  await page.getByRole("link", { name: "Open it" }).click();
  await page.getByRole("heading", { name: "Swap the truck photos" }).waitFor();

  // The calendar address: made, and shown once.
  await page.goto(t.origin + "/calendar-feed");
  await page.getByRole("button", { name: "Make my address" }).click();
  await page.getByRole("heading", { name: "Your calendar address" }).waitFor();
  assert.match(await page.getByLabel("Subscribe to this in your calendar").inputValue(), /\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
  await assertAccessible(page, "the calendar address, shown once");

  // A webhook: added, its secret shown once, then its own page.
  await page.goto(t.origin + "/webhooks");
  await page.getByLabel("Address", { exact: true }).fill("https://n8n.example.com/webhook/hq");
  await page.getByLabel("A task is done").check();
  await page.getByRole("button", { name: "Add webhook" }).click();
  await page.getByRole("heading", { name: "Webhook added" }).waitFor();
  await assertAccessible(page, "a webhook's secret, shown once");
  await page.getByRole("link", { name: "Done" }).click();
  await page.getByRole("button", { name: "Send a test" }).click();
  await page.getByText("A test is queued.").waitFor();
  await assertAccessible(page, "a webhook with a delivery waiting");
  assert.deepEqual(problems, []);
  await page.close();
});

test("subtasks and blocking on a task's page", async () => {
  const page = await signedIn.newPage();
  const problems = watch(page);
  await page.goto(`${t.origin}/projects/${projectId}/tasks`);
  await page.getByLabel("Title").fill("Launch the menu page");
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByText("Task added.").waitFor();
  await page.getByRole("link", { name: "Launch the menu page" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/tasks/"));
  await page.getByLabel("New subtask").fill("Proofread the prices");
  await page.getByRole("button", { name: "Add subtask" }).click();
  await page.getByText("Subtask added.").waitFor();
  await page.getByLabel("It waits on").selectOption({ label: "Set up hosting" });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("It now waits on that task.").waitFor();
  await assertAccessible(page, "a task with a subtask and a blocker");
  await page.getByRole("link", { name: "Proofread the prices" }).click();
  await page.getByText("Subtask of").waitFor();
  await assertAccessible(page, "a subtask");

  // Comments and files on the same page.
  await page.getByLabel("Add a comment").fill("Prices checked against the paper menu. @mikey");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.getByText("Comment added.").waitFor();
  const proof = join(scratch, "menu-proof.pdf");
  writeFileSync(proof, PDF);
  await page.getByLabel("Attach a file").setInputFiles(proof);
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  await page.getByText("File attached.").waitFor();
  await page.getByText("Edit your comment", { exact: true }).click();
  await page.getByLabel("Your comment", { exact: true }).fill("Prices checked against the paper menu and the website. @mikey");
  await page.getByRole("button", { name: "Save comment" }).click();
  await page.getByText("Comment saved.").waitFor();
  await page.getByText("Edit your comment", { exact: true }).click();
  await assertAccessible(page, "a task with a comment, a file and the edit form open");
  await page.getByRole("button", { name: "Remove menu-proof.pdf" }).click();
  await page.getByText("Removed “menu-proof.pdf”.").waitFor();

  // Back to the parent, and make it repeat.
  await page.getByRole("link", { name: "Launch the menu page" }).click();
  await page.getByLabel("Every", { exact: true }).fill("2");
  await page.getByLabel("Unit").selectOption("month");
  await page.getByRole("button", { name: "Make it repeat" }).click();
  await page.getByText("It repeats now.").waitFor();
  await page.getByText("Every 2 months, from the due date").first().waitFor();
  await assertAccessible(page, "a repeating task");
  assert.deepEqual(problems, []);
  await page.close();
});

test("share a project by link, and comment through it with no account", async () => {
  const page = await signedIn.newPage();
  const problems = watch(page);
  await page.goto(`${t.origin}/projects/${projectId}#share`);
  await assertAccessible(page, "a project with its share links");
  await page.getByLabel("Who it's for").fill("Dale at the bakery");
  await page.getByLabel("They may").selectOption("comment");
  await page.getByRole("button", { name: "Make the link" }).click();
  await page.getByRole("heading", { name: "A link for Dale at the bakery" }).waitFor();
  await assertAccessible(page, "a share link, shown once");
  const link = await page.getByLabel("Send them this link").inputValue();
  assert.match(link, /\/s\/[A-Za-z0-9_-]{43}$/);
  await page.close();

  const outsider = await browser.newContext();
  const visit = await outsider.newPage();
  const visitProblems = watch(visit);
  await visit.goto(link);
  await visit.getByText("Shared by Potomac Solutions with Dale at the bakery").waitFor();
  await assertAccessible(visit, "the shared project");
  const first = visit.locator(".shared-comment-form").first();
  await first.locator("summary").click();
  await first.getByLabel("Your name").fill("Dale");
  await first.getByLabel("Your comment").fill("Looks great so far.");
  await first.getByRole("button", { name: "Send comment" }).click();
  await visit.getByText("Comment added. The team will see it.").waitFor();
  await visit.getByText("Looks great so far.").waitFor();
  await assertAccessible(visit, "the shared project with a comment");
  assert.deepEqual(visitProblems, []);
  await outsider.close();
  assert.deepEqual(problems, []);
});

test("import a Trello board into a project, after a preview", async () => {
  const page = await signedIn.newPage();
  const problems = watch(page);
  const board = join(scratch, "board.json");
  writeFileSync(board, JSON.stringify({ name: "Bakery board", lists: [{ id: "l", name: "Doing", closed: false }], labels: [{ id: "g", name: "Menu", color: "green" }], cards: [{ id: "c", name: "Photograph the pies", idList: "l", closed: false, idLabels: ["g"] }], checklists: [{ idCard: "c", checkItems: [{ name: "Apple", state: "incomplete" }] }] }));
  await page.goto(`${t.origin}/projects/${projectId}/tasks`);
  await page.getByRole("link", { name: "Import tasks from Trello or Todoist" }).click();
  await assertAccessible(page, "the import page");
  await page.getByLabel("Trello: the board's JSON export").check();
  await page.getByLabel("The file").setInputFiles(board);
  await page.getByRole("button", { name: "Show what it would make" }).click();
  await page.getByRole("heading", { name: "Import from Trello: Bakery board" }).waitFor();
  await assertAccessible(page, "an import preview");
  await page.getByRole("button", { name: "Import 2 tasks" }).click();
  await page.getByText("Imported 1 task and 1 subtask, with 1 new label.").waitFor();
  await page.getByRole("link", { name: "Photograph the pies" }).waitFor();
  assert.deepEqual(problems, []);
  await page.close();
});

test("the pipeline: a card dragged to the next column moves a stage", async () => {
  const crm = await import("../../src/crm/index.ts");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const client = crm.createClient(t.services.crm, mikey, { name: "Gormania Feed" });
  assert.ok(client.ok);
  assert.ok(crm.createOpportunity(t.services.crm, mikey, client.value.id, { title: "Feed store site", leadSource: "phone" }).ok);

  const page = await signedIn.newPage();
  const problems = watch(page);
  await page.goto(t.origin + "/pipeline");
  const column = (name: string) => page.locator("section.hq-column", { has: page.getByRole("heading", { name: new RegExp(`^${name}`) }) });
  await page.locator(".hq-card", { hasText: "Feed store site" }).dragTo(column("Consult booked"));
  await page.getByText("Stage changed.").waitFor();
  assert.equal(await column("Consult booked").locator(".hq-card").count(), 1);
  // Two columns on is not the next stage: the server says so, and nothing moves.
  await page.locator(".hq-card", { hasText: "Feed store site" }).dragTo(column("Quoted"));
  await page.getByText("Stages move forward one at a time.").waitFor();
  assert.equal(await column("Consult booked").locator(".hq-card").count(), 1);
  await assertAccessible(page, "the pipeline");
  assert.deepEqual(problems, []);
  await page.close();
});

test("the board and the plan work with JavaScript turned off", async () => {
  const state = await signedIn.storageState();
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: state });
  const page = await context.newPage();
  await page.goto(t.origin + "/board");
  await page.getByLabel("Move Set up hosting to").selectOption("blocked");
  await page.getByRole("button", { name: "Move: Set up hosting" }).click();
  await page.getByText("Task moved.").waitFor();
  assert.match(await text(page, "section.board-column:nth-of-type(3)"), /Set up hosting/);
  await page.goto(`${t.origin}/projects/${projectId}`);
  await page.getByText("Add a milestone").click();
  await page.getByLabel("Milestone", { exact: true }).fill("Launch");
  await page.getByRole("button", { name: "Add milestone" }).click();
  await page.getByText("Milestone added.").waitFor();
  await context.close();
});
