// The keyboard pass (Mikey, 2026-11-25), in a real browser: the skip link,
// the command bar as a dialog (focus kept inside, Escape, focus put back),
// decision 0014's Undo bar and brought-back text reached and announced, and the duplicate
// question and merge form. Automated only: see
// docs/reviews/2026-11-25-keyboard-and-screen-reader.md for what it can't tell.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, watch } from "../support/browser.ts";
import { TEST_PASSWORD_COST, testApp, wonProject, type TestApp } from "../support/harness.ts";

let t: TestApp;
let browser: Browser;
before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await t.stop();
});

// Strings, since the tests are type-checked without the DOM's types.
const focused = async (page: import("playwright").Page) =>
  String(await page.evaluate(`(() => { const el = document.activeElement; return el ? el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : "") : ""; })()`));
// waitForFunction with a string would be eval in the page, which the CSP refuses.
type Doc = { readonly document: { readonly activeElement: { readonly id: string; readonly classList: { contains(name: string): boolean } } | null } };
const focusIs = ({ want }: { want: string }) => {
  const el = (globalThis as unknown as Doc).document.activeElement;
  return Boolean(el && (el.id === want || el.classList.contains(want)));
};
const inDialog = `Boolean(document.querySelector(".cmd")?.contains(document.activeElement))`;

test("skip link, the command bar as a dialog, Undo and a brought-back draft, from the keyboard", async () => {
  const page = await (await browser.newContext()).newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const { project, client } = await wonProject(t.services, mikey, { client: "Keyboard Cafe" });
  const projects = await import("../../src/projects/index.ts");
  const task = projects.addTask(t.services.projects, mikey, project.id, { title: "Write the menu" });
  assert.ok(task.ok);

  // The first Tab reaches the skip link, and it moves focus to the page.
  await page.goto(`${t.origin}/projects/${project.id}`);
  await page.keyboard.press("Tab");
  assert.equal(await focused(page), "a.skip-link");
  await page.keyboard.press("Enter");
  assert.equal(await focused(page), "main#main.hq-main");

  // "/" opens the command bar on its search box; Tab stays inside; Escape closes it and puts focus back.
  await page.locator(".cmd-open").focus();
  await page.keyboard.press("/");
  await page.getByRole("dialog", { name: "Go to a page or record" }).waitFor();
  await page.waitForFunction(focusIs, { want: "cmd-q" }, { timeout: 2000 });
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    assert.ok(await page.evaluate(inDialog), `Tab ${i + 1} stays in the dialog`);
  }
  await page.keyboard.press("Shift+Tab");
  assert.ok(await page.evaluate(inDialog), "Shift+Tab stays too");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.waitForFunction(focusIs, { want: "cmd-open" }, { timeout: 2000 });

  // Moving a task offers decision 0014's Undo, announced, and it works from the keyboard.
  if (!task.ok) return;
  await page.goto(`${t.origin}/tasks/${task.value.id}`);
  await page.locator("#task-status").selectOption("doing");
  await page.locator("form[action$='/status'] button[type=submit]").first().click();
  const undo = page.locator(".hq-undo[role=region]");
  await undo.waitFor();
  assert.match(await undo.locator("[role=status]").innerText(), /\S/, "the bar says what it puts back");
  await assertAccessible(page, "the Undo bar");
  await page.locator("#hq-undo-button").focus();
  await page.keyboard.press("Enter");
  await page.waitForLoadState("load");
    for (let i = 0; i < 20 && t.services.projects.tasks.get(task.value.id)?.status !== "todo"; i += 1) await page.waitForTimeout(100);
  assert.equal(t.services.projects.tasks.get(task.value.id)?.status, "todo");

  // Typing in a message box survives a reload, and saying so is announced.
  await page.goto(`${t.origin}/clients/${client.id}`);
  const box = page.locator("#note-body");
  await box.focus();
  await page.keyboard.type("Rita asked for a Friday call");
  await page.waitForTimeout(600);
  await page.reload();
  await page.getByText(/Brought back text you hadn’t sent/).waitFor();
  assert.equal(await page.locator("#note-body").inputValue(), "Rita asked for a Friday call");
  await assertAccessible(page, "brought-back text");

  // A client like one already here asks first; the merge form, light and dark.
  await page.goto(`${t.origin}/clients`);
  await page.getByLabel("Business name").fill("Keyboard Cafe LLC");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByText(/is already in HQ/).waitFor();
  const anyway = page.getByLabel(/It’s a different business/);
  await anyway.focus();
  await page.keyboard.press("Space");
  assert.ok(await anyway.isChecked());
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await assertAccessible(page, `the duplicate question (${colorScheme})`);
  }
  await page.getByLabel("Business name").fill("Keyboard Cafe LLC");
  await page.getByRole("button", { name: "Add client" }).click();
  await page.waitForURL((url) => /^\/clients\/[0-9a-f-]+$/.test(url.pathname));
  await page.locator("#merge summary").focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Merge it into").selectOption({ label: "Keyboard Cafe (looks the same)" });
  await assertAccessible(page, "the merge form");
  assert.deepEqual(problems, []);
});
