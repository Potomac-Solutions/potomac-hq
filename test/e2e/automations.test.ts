// Client automations in a real browser (decision 0010, slice 6): add one on
// a client, copy its check-in address, see it check in and fail. Each screen
// is checked for accessibility, light and dark.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";

let t: TestApp;
let browser: Browser;
before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: "https://hq.example" });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await t.stop();
});

test("add an automation and watch it check in", async () => {
  const page = await (await browser.newContext()).newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  const mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const moats = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Moats Hardware" })).id;
  await page.goto(`${t.origin}/clients/${moats}`);
  await page.getByText("Add an automation").click();
  await page.getByRole("textbox", { name: /^Name/ }).last().fill("Orders to the sheet");
  await page.getByRole("button", { name: "Add and get its address" }).click();
  await page.getByRole("heading", { name: "Added: Orders to the sheet" }).waitFor();
  await assertAccessible(page, "an automation's check-in address");
  const address = await page.getByLabel(/Check-in address/).inputValue();
  assert.match(address, /^https:\/\/hq\.example\/hooks\/automations\/[A-Za-z0-9_-]{43}$/);
  await fetch(`${t.origin}${new URL(address).pathname}?status=failed&message=Sheet%20not%20found`, { method: "POST" });
  await page.getByRole("link", { name: "Done" }).click();
  await page.getByText("Sheet not found").first().waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.reload();
    await assertAccessible(page, `a client with an automation (${colorScheme})`);
  }
  await page.getByRole("link", { name: "Automations" }).first().click();
  await page.getByRole("heading", { name: "Automations" }).waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.reload();
    await assertAccessible(page, `automations (${colorScheme})`);
  }
  assert.match(await text(page), /Orders to the sheet\s*Moats Hardware\s*Every day\s*Failed/);
  assert.deepEqual(problems, []);
});
