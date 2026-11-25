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

async function opportunity(title: string) {
  const crm = await import("../../src/crm/index.ts");
  const client = crm.createClient(t.services.crm, mikey, { name: `${title} Co` });
  assert.ok(client.ok);
  const made = crm.createOpportunity(t.services.crm, mikey, client.value.id, { title, leadSource: "phone" });
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
  await page.getByRole("region", { name: "Removed" }).waitFor();
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
