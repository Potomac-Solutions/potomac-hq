// Decision 0014 in a real browser: moving cards by keyboard and by finger,
// the command palette and shortcuts, removals that wait for Undo, undoing an
// edit, keeping your place, the unsaved-form warning, and done messages that
// fade. Every screen is checked by axe.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, watch } from "../support/browser.ts";
import { testApp, wonProject, type TestApp } from "../support/harness.ts";

let t: TestApp;
let browser: Browser;
let signedIn: BrowserContext;
let mikey: Id;
let projectId = "";

before(async () => {
  t = await testApp();
  browser = await chromium.launch();
  signedIn = await browser.newContext();
  const page = await signedIn.newPage();
  await setUpAdmin(t, page);
  await page.close();
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  projectId = (await wonProject(t.services, mikey)).project.id;
});
after(async () => {
  await browser?.close();
  await t.stop();
});

async function opportunity(title: string, service?: string) {
  const crm = await import("../../src/crm/index.ts");
  const client = crm.createClient(t.services.crm, mikey, { name: `${title} Co` });
  assert.ok(client.ok);
  const made = crm.createOpportunity(t.services.crm, mikey, client.value.id, { title, leadSource: "phone", ...(service ? { service } : {}) });
  assert.ok(made.ok);
  return made.value.id;
}
/** Waits until `check` is true, for things the browser does in the background. */
async function until(check: () => boolean, what: string): Promise<void> {
  for (let tries = 0; tries < 100; tries++) {
    if (check()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.fail(what);
}
const column = (page: Page, name: string) => page.locator("section.hq-column", { has: page.getByRole("heading", { name: new RegExp(`^${name}`) }) });

test("a pipeline card moves with the keyboard, and keeps focus after the page comes back", async () => {
  await opportunity("Keyboard deal");
  const page = await signedIn.newPage();
  const problems = watch(page);
  await page.goto(t.origin + "/pipeline");
  const card = page.locator(".hq-card", { hasText: "Keyboard deal" });
  await card.focus();
  await page.keyboard.press("Space");
  await page.getByText("Picked up Keyboard deal").waitFor({ state: "attached" });
  await assertAccessible(page, "the pipeline with a card picked up");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  // Only the next stage, or back: two on isn't offered.
  assert.match((await column(page, "Consult booked").getAttribute("class")) ?? "", /hq-column-over/);
  await page.keyboard.press("Space");
  await page.getByText("Moved to Consult booked.").waitFor();
  assert.equal(await column(page, "Consult booked").locator(".hq-card", { hasText: "Keyboard deal" }).count(), 1);
  // Runs in the page: focus came back to the moved card.
  await page.waitForFunction("document.activeElement?.dataset?.vt?.startsWith('card-') === true");
  // Escape puts a picked-up card back.
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");
  await page.getByText("Keyboard deal put back in Consult booked.").waitFor({ state: "attached" });
  assert.deepEqual(problems, []);
  await page.close();
});

test("a pipeline card moves with a finger, by its grip", async () => {
  await opportunity("Finger deal");
  const context = await browser.newContext({ storageState: await signedIn.storageState(), hasTouch: true });
  const page = await context.newPage();
  await page.goto(t.origin + "/pipeline");
  const grip = page.locator(".hq-card", { hasText: "Finger deal" }).locator(".hq-grip-handle");
  const from = (await grip.boundingBox())!;
  const to = (await column(page, "Consult booked").boundingBox())!;
  const at = (x: number, y: number) => ({ pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, bubbles: true });
  await grip.dispatchEvent("pointerdown", at(from.x + 5, from.y + 10));
  for (const step of [0.25, 0.5, 0.75, 1]) await grip.dispatchEvent("pointermove", at(from.x + (to.x + 60 - from.x) * step, from.y + (to.y + 80 - from.y) * step));
  assert.match((await column(page, "Consult booked").getAttribute("class")) ?? "", /hq-column-over/);
  await grip.dispatchEvent("pointerup", at(to.x + 60, to.y + 80));
  await page.getByText("Moved to Consult booked.").waitFor();
  assert.equal(await column(page, "Consult booked").locator(".hq-card", { hasText: "Finger deal" }).count(), 1);
  await context.close();
});

test("the command palette goes anywhere and moves a deal; ? lists the shortcuts; G then P goes to the pipeline", async () => {
  await opportunity("Palette deal");
  const page = await signedIn.newPage();
  const problems = watch(page);
  await page.goto(t.origin + "/today");
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox", { name: "Go to, find or do" });
  await box.waitFor();
  await assertAccessible(page, "the command palette");
  await box.fill("Palette deal");
  const move = page.getByRole("option", { name: /Move Palette deal to Consult booked/ });
  await move.waitFor();
  await page.keyboard.press("Enter");
  await page.getByText("Moved to Consult booked.").waitFor();
  assert.match(page.url(), /\/opportunities\//);

  await page.getByRole("button", { name: /Go to/ }).click();
  await box.fill("clients");
  await page.getByRole("option", { name: /Clients/ }).first().waitFor();
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.pathname === "/clients");

  await page.keyboard.press("Shift+?");
  await page.getByRole("heading", { name: "Keyboard shortcuts" }).waitFor();
  await assertAccessible(page, "the keyboard shortcuts");
  await page.keyboard.press("Escape");
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await page.waitForURL((url) => url.pathname === "/pipeline");
  assert.deepEqual(problems, []);
  await page.close();
});

test("a removal waits for Undo, then goes through", async () => {
  const projects = await import("../../src/projects/application/commands.ts");
  assert.ok(projects.addProjectLink(t.services.projects, mikey, projectId as Id, { kind: "staging", label: "Staging site", url: "https://staging.example.com", shared: false }).ok);
  const page = await signedIn.newPage();
  const problems = watch(page);
  await page.goto(t.origin + `/projects/${projectId}`);
  const link = page.locator("#links li", { hasText: "Staging site" });
  await link.getByRole("button", { name: /Remove/ }).click();
  await page.getByRole("region", { name: "Waiting to go" }).waitFor();
  await page.getByText("Removed.", { exact: true }).waitFor();
  assert.equal(await link.isVisible(), false, "hidden at once");
  await assertAccessible(page, "a removal waiting for Undo");
  await page.getByRole("button", { name: "Undo" }).click();
  assert.equal(await link.isVisible(), true, "back on Undo");
  assert.equal(t.db.prepare("select count(*) as n from project_link").get()?.["n"], 1, "nothing was sent");

  await link.getByRole("button", { name: /Remove/ }).click();
  await page.getByText("Link removed.").waitFor({ timeout: 10_000 });
  assert.equal(t.db.prepare("select count(*) as n from project_link").get()?.["n"], 0);
  assert.deepEqual(problems, []);
  await page.close();
});

test("an edit can be undone; done messages fade; a typed form asks before you leave", async () => {
  const projects = await import("../../src/projects/application/commands.ts");
  const task = projects.addTask(t.services.projects, mikey, projectId as Id, { title: "Write the about page" });
  assert.ok(task.ok);
  const page = await signedIn.newPage();
  const problems = watch(page);
  await page.goto(t.origin + `/tasks/${task.value.id}`);
  const form = page.locator(`form[action="/tasks/${task.value.id}"]`);
  await form.getByLabel("Title").fill("Write the about us page");
  await form.getByRole("button", { name: "Save task" }).click();
  await page.getByText("Task saved.").waitFor();
  assert.equal(t.db.prepare("select title from task where id = ?").get(task.value.id)?.["title"], "Write the about us page");
  await page.getByRole("button", { name: "Undo" }).click();
  await until(() => t.db.prepare("select title from task where id = ?").get(task.value.id)?.["title"] === "Write the about page", "the title went back");
  await page.waitForLoadState();
  await page.getByText("Task saved.").waitFor();

  // The green message goes after a few seconds.
  await page.getByText("Task saved.").waitFor({ state: "hidden", timeout: 10_000 });

  // Typed and not sent: leaving asks first.
  await form.getByLabel("Title").fill("Something else");
  let asked = false;
  page.once("dialog", (dialog) => {
    asked = dialog.type() === "beforeunload";
    void dialog.dismiss();
  });
  await page.getByRole("link", { name: "Today", exact: true }).click();
  await page.waitForTimeout(500);
  assert.ok(asked, "leaving with a typed form asks");
  assert.match(page.url(), /\/tasks\//, "and staying stays");
  assert.deepEqual(problems, []);
  await page.close();
});

test("a form can't be sent twice by a double click", async () => {
  const id = await opportunity("Double deal");
  const page = await signedIn.newPage();
  await page.goto(t.origin + `/opportunities/${id}`);
  await page.getByRole("button", { name: "Move to Consult booked" }).dblclick();
  await page.getByText(/Moved to Consult booked\.|Stages move/).first().waitFor();
  assert.equal(t.db.prepare("select stage from opportunity where id = ?").get(id)?.["stage"], "consult-booked");
  assert.doesNotMatch(await page.locator("main").innerText(), /Stages move forward/, "the second click was never sent");
  await page.close();
});

test("Recent changes lists what can be undone, one per thing, and undoes an older change", async () => {
  const id = await opportunity("History deal", "website");
  const projects = await import("../../src/projects/application/commands.ts");
  const task = projects.addTask(t.services.projects, mikey, projectId as Id, { title: "Order the sign" });
  assert.ok(task.ok);
  const page = await signedIn.newPage();
  const problems = watch(page);
  await page.goto(t.origin + `/opportunities/${id}`);
  await page.getByRole("button", { name: "Move to Consult booked" }).click();
  await page.getByText("Moved to Consult booked.").first().waitFor();
  await page.getByRole("button", { name: "Move to Consulted" }).click();
  await page.getByText("Moved to Consulted.").first().waitFor();
  await page.goto(t.origin + `/tasks/${task.value.id}`);
  await page.locator(`form[action="/tasks/${task.value.id}"]`).getByLabel("Title").fill("Order the shop sign");
  await page.getByRole("button", { name: "Save task" }).click();
  await page.getByText("Task saved.").first().waitFor();

  await page.keyboard.press("g");
  await page.keyboard.press("h");
  await page.waitForURL((url) => url.pathname === "/history");
  const main = page.locator("main");
  const listed = (label: string) => main.locator(".changes strong", { hasText: label });
  await listed("Order the sign: details saved").waitFor();
  await listed("History deal: moved to Consulted").waitFor();
  assert.equal(await listed("History deal: moved to Consult booked").count(), 0, "only the newest change to the same deal");
  await assertAccessible(page, "recent changes");
  await main.getByRole("button", { name: /Undo.*History deal: moved to Consulted/ }).click();
  await page.getByText("Moved back to Consult booked.").first().waitFor();
  assert.equal(t.db.prepare("select stage from opportunity where id = ?").get(id)?.["stage"], "consult-booked");
  // The undo bar says what happened and links here.
  await page.locator(".hq-undo").getByRole("link", { name: "History" }).click();
  await page.waitForURL((url) => url.pathname === "/history");
  assert.deepEqual(problems, []);
  await page.close();
});

test("sending something waits for Undo, and nothing is sent if it's called back", async () => {
  const page = await signedIn.newPage();
  await page.goto(t.origin + "/today");
  const posted: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posted.push(new URL(request.url()).pathname);
  });
  // A stand-in for any Send button: the hold is the same for every one.
  await page.evaluate(`(() => {
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/invoices/00000000-0000-0000-0000-000000000000/send";
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "Send the invoice";
    form.append(button);
    document.querySelector("main").append(form);
  })()`);
  await page.getByRole("button", { name: "Send the invoice" }).click();
  await page.getByText("Sending…").waitFor();
  await assertAccessible(page, "a send waiting for Undo");
  await page.keyboard.press("Control+z");
  await page.getByText("Not sent.").waitFor();
  await page.waitForTimeout(9000);
  assert.deepEqual(posted, [], "called back before it went");
  await page.close();
});

test("adding can be undone; Ctrl+Enter sends; unsent text comes back after the page closes", async () => {
  const projects = await import("../../src/projects/application/commands.ts");
  const task = projects.addTask(t.services.projects, mikey, projectId as Id, { title: "Pick the colours" });
  assert.ok(task.ok);
  const page = await signedIn.newPage();
  const problems = watch(page);
  await page.goto(t.origin + `/tasks/${task.value.id}`);
  const comments = () => Number(t.db.prepare("select count(*) as n from task_comment where task_id = ?").get(task.value.id)?.["n"]);

  // Ctrl+Enter sends; Undo takes the comment away again.
  const box = page.getByLabel("Add a comment");
  await box.fill("Navy and cream, like the old sign.");
  await box.press("Control+Enter");
  await page.locator(".hq-undo").getByText("Comment added").waitFor();
  assert.equal(comments(), 1);
  await page.locator(".hq-undo").getByRole("button", { name: "Undo" }).click();
  await page.getByText("Comment deleted.").first().waitFor();
  assert.equal(comments(), 0);

  // Typed, then the page goes away before it's sent: it comes back, and Discard clears it.
  await page.getByLabel("Add a comment").fill("Half a thought about the logo");
  await page.waitForTimeout(600);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await page.getByText("Brought back text you hadn’t sent.").waitFor();
  assert.equal(await page.getByLabel("Add a comment").inputValue(), "Half a thought about the logo");
  await assertAccessible(page, "unsent text brought back");
  await page.getByRole("button", { name: "Discard" }).click();
  assert.equal(await page.getByLabel("Add a comment").inputValue(), "");
  assert.deepEqual(problems, []);
  await page.close();
});

test("what can't be undone asks first, with Cancel as the default", async () => {
  const page = await signedIn.newPage();
  await page.goto(t.origin + "/settings");
  const posted: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posted.push(new URL(request.url()).pathname);
  });
  // A stand-in for the real button, which only shows once two-step sign-in is on.
  await page.evaluate(`(() => {
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/settings/two-factor/off";
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "Turn off two-step sign-in";
    form.append(button);
    document.querySelector("main").append(form);
  })()`);
  await page.getByRole("button", { name: "Turn off two-step sign-in" }).click();
  const dialog = page.getByRole("dialog", { name: "This can’t be undone" });
  await dialog.waitFor();
  await assertAccessible(page, "the confirm step");
  assert.equal(await dialog.getByRole("button", { name: "Cancel" }).evaluate((button) => button === (button.ownerDocument as { activeElement: unknown }).activeElement), true, "Cancel has focus");
  await page.keyboard.press("Enter");
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(posted, [], "cancelled: nothing sent");
  await page.getByRole("button", { name: "Turn off two-step sign-in" }).click();
  await dialog.getByRole("button", { name: "Turn it off" }).click();
  await page.waitForLoadState();
  await new Promise((done) => setTimeout(done, 300));
  assert.deepEqual(posted, ["/settings/two-factor/off"], "confirmed: sent once");
  await page.close();
});

test("a link added to a project can be undone", async () => {
  const page = await signedIn.newPage();
  await page.goto(t.origin + `/projects/${projectId}#links`);
  const before = Number(t.db.prepare("select count(*) as n from project_link").get()?.["n"]);
  await page.getByText("Add a link").click();
  await page.locator('form[action$="/links"]').getByLabel("Web address").fill("https://design.example.com");
  await page.locator('form[action$="/links"]').getByRole("button").last().click();
  await page.locator(".hq-undo").getByText("Link added: https://design.example.com").waitFor();
  assert.equal(Number(t.db.prepare("select count(*) as n from project_link").get()?.["n"]), before + 1);
  await page.keyboard.press("Control+z");
  await page.getByText("Link removed.").first().waitFor();
  assert.equal(Number(t.db.prepare("select count(*) as n from project_link").get()?.["n"]), before);
  await page.close();
});
