// Decision 0016's screens in a real browser, each checked for accessibility
// light and dark, with the content security policy in force.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, sidebar, text, watch } from "../support/browser.ts";
import { TEST_PASSWORD_COST, testApp, wonProject, type TestApp } from "../support/harness.ts";

let t: TestApp;
let browser: Browser;
before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, vapidPublicKey: "B".repeat(87) });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await t.stop();
});

test("status, workload, notice settings, many at once, view as a member, and the phone section", async () => {
  const page = await (await browser.newContext()).newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const { project } = await wonProject(t.services, mikey);
  const projects = await import("../../src/projects/index.ts");
  projects.addTask(t.services.projects, mikey, project.id, { title: "Menu page" });
  projects.addTask(t.services.projects, mikey, project.id, { title: "Order form" });

  for (const [hub, name, url] of [["Company", "System status", "/status"], ["Work", "Team workload", "/workload"]] as const) {
    void hub;
    await sidebar(page, name);
    await page.waitForURL((u) => u.pathname === url);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.reload();
      await assertAccessible(page, `${name} (${colorScheme})`);
    }
  }

  // Many at once.
  await page.goto(t.origin + "/work");
  await page.getByLabel("Pick Menu page").check();
  await page.getByLabel("Pick Order form").check();
  await page.getByLabel("With the ticked ones").selectOption("status");
  await page.locator("#bulk-status").selectOption("doing");
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByText("Changed 2.").waitFor();
  await assertAccessible(page, "All work with boxes to tick");

  // Notice settings.
  await page.goto(t.origin + "/notices");
  await page.getByRole("button", { name: "Email them to me" }).click();
  await page.getByLabel("A comment that mentions you").selectOption("daily");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved. The bell still shows every notice.").waitFor();
  await assertAccessible(page, "notice settings");

  // The phone section on Settings.
  await page.goto(t.origin + "/settings");
  await page.getByRole("heading", { name: "Phone alerts and the HQ app" }).waitFor();
  await assertAccessible(page, "Settings with phone alerts");

  // View as a member: their sidebar, and nothing can change.
  await page.goto(t.origin + "/people");
  await page.getByRole("button", { name: "View as a member" }).click();
  await page.getByText("You’re viewing HQ as a member").waitFor();
  assert.doesNotMatch(await text(page, "nav"), /System status|Audit history/);
  await assertAccessible(page, "viewing as a member");
  await page.getByRole("button", { name: "Stop viewing" }).click();
  await page.waitForURL((u) => u.pathname === "/people");
  assert.equal(await page.getByText("You’re viewing HQ as a member").count(), 0);

  assert.deepEqual(problems, []);
});
