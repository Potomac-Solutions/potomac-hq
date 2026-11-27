// Removing a member in a real browser (decision 0025): from People, an admin
// opens Remove from HQ, sees the open work, keeps herself as the one taking
// over, confirms, and the member is gone from the list. The page gets the
// accessibility check, in light and in dark, and fits a phone.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { addTodo } from "../../src/todos/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, watch } from "../support/browser.ts";
import { signIn, TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";

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

test("an admin removes a member from People, handing their to-do to herself", async () => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
  const sam = t.db.prepare("select id from user where email = 'sam@example.com'").get()?.["id"] as Id;
  unwrap(addTodo(t.services.todos, mikey, { title: "Call the feed store", assigneeId: sam }));

  await page.goto(`${t.origin}/people`);
  await page.getByText("Change Sam Helper").click();
  await page.getByRole("link", { name: "Remove Sam Helper from HQ" }).click();
  await page.getByRole("heading", { name: "Remove Sam Helper from HQ" }).waitFor();
  await page.getByText("1 to-do not done").waitFor();
  assert.equal(await page.getByLabel("Who takes over their open work").inputValue(), mikey);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await assertAccessible(page, `removing a member (${colorScheme})`);
  }
  assert.ok(Number(await page.evaluate("document.documentElement.scrollWidth")) <= 390, "fits a phone");

  await page.getByRole("button", { name: "Remove Sam Helper" }).click();
  assert.match(page.url(), /\/remove$/, "the box must be ticked first");
  await page.getByLabel(/I understand Sam Helper is removed for good/).check();
  await page.getByRole("button", { name: "Remove Sam Helper" }).click();
  await page.getByText("Sam Helper was removed from HQ.").waitFor();
  assert.equal(await page.getByText("Change Sam Helper").count(), 0);
  assert.deepEqual(problems, []);
});
