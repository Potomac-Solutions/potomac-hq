// Importing clients in a real browser: paste a list on Clients → Import, see
// it refused with the line to fix and the paste kept, fix it, and find the
// demos marked. Each screen is checked for accessibility.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { assertAccessible, setUpAdmin } from "../support/browser.ts";
import { TEST_PASSWORD_COST, testApp, type TestApp } from "../support/harness.ts";

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

const LIST = `Client,Contact,Phone,Project,Pricing,Price,Repository,Demo
Elk Diner,Dana Reyes,304-555-0142,Website,fixed,,https://github.com/example/elk-diner,no
Hickory Hollow Bakehouse,,,Counter,free,,https://github.com/example/counter,yes`;

test("paste a list, fix the line it names, and find the demo marked", async () => {
  const page = await (await browser.newContext()).newPage();
  await setUpAdmin(t, page);
  await page.goto(`${t.origin}/clients`);
  await page.getByRole("link", { name: "Import clients" }).click();
  await page.getByRole("heading", { name: "Import clients" }).waitFor();
  await assertAccessible(page, "Clients, Import");

  await page.getByLabel("Clients, as CSV").fill(LIST);
  await page.getByRole("button", { name: "Import" }).click();
  await page.getByText("Line 2: a fixed project needs its price, like 1500. Nothing was imported.").waitFor();
  await page.getByLabel("Clients, as CSV").focus();
  assert.equal(await page.getByLabel("Clients, as CSV").inputValue(), LIST, "what was pasted is still there to fix");

  await page.getByLabel("Clients, as CSV").fill(LIST.replace("Website,fixed,,", "Website,fixed,1500,"));
  await page.getByRole("button", { name: "Import" }).click();
  await page.getByText("Imported 2 clients with 2 projects. 1 is a demo.").waitFor();
  await page.getByRole("row", { name: /Hickory Hollow Bakehouse Demo/ }).waitFor();
  await assertAccessible(page, "Clients, with a demo");
  await page.getByRole("link", { name: "Hickory Hollow Bakehouse" }).click();
  await page.getByRole("button", { name: "It’s a real client" }).waitFor();
});
