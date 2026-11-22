// Booking in a real browser: setting the hours, then the Calls page. Each
// screen is checked for accessibility, in light and dark.
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

test("set the hours, then see them on Calls", async () => {
  const page = await (await browser.newContext()).newPage();
  await setUpAdmin(t, page);
  await page.goto(`${t.origin}/calls/hours`);
  await page.getByLabel("Monday, first stretch starts").fill("09:00");
  await page.getByLabel("Monday, first stretch ends").fill("12:00");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText("Saved. The open times have changed.").waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(`${t.origin}/calls/hours`);
    await assertAccessible(page, `hours for calls (${colorScheme})`);
    await page.goto(`${t.origin}/calls`);
    await page.getByRole("heading", { name: "Coming up" }).waitFor();
    await assertAccessible(page, `calls (${colorScheme})`);
  }
});
