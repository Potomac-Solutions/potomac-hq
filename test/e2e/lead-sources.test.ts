// The lead sources report in a real browser (decision 0013, slice 3): an
// inquiry from a river stop shows on the report and on its opportunity.
// Each screen is checked for accessibility, light and dark.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { httpClient, TEST_PASSWORD_COST, testApp, type TestApp } from "../support/harness.ts";

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

test("see where leads came from, and open one", async () => {
  const page = await (await browser.newContext()).newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  await httpClient(t.origin).post("/contact", { name: "Kay Lambert", email: "kay@example.com", message: "Kayak rentals at the lake", src: "stop:lakes" });
  await page.goto(`${t.origin}/reports`);
  await page.getByRole("link", { name: "Lead sources" }).click();
  await page.getByRole("heading", { name: "1 lead" }).waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.reload();
    await assertAccessible(page, `lead sources (${colorScheme})`);
  }
  assert.match(await text(page), /River stop: Lakes and outdoors/);
  await page.goto(`${t.origin}/pipeline`);
  await page.getByRole("link", { name: /Kayak rentals/ }).first().click();
  await page.getByText("River stop: Lakes and outdoors").waitFor();
  await assertAccessible(page, "opportunity with where it came from");
  assert.deepEqual(problems, []);
});
