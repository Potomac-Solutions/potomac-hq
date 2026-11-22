// The top bar holds up to ten links and two buttons. At every width from a
// phone to a wide screen, nothing in it runs off the edge.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { assertAccessible, setUpAdmin } from "../support/browser.ts";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { PASSWORD, TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";

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

test("an admin's top bar fits at every width", async () => {
  const page = await (await browser.newContext()).newPage();
  await setUpAdmin(t, page);
  for (const width of [1440, 1280, 1120, 1024, 900, 768, 641, 640, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${t.origin}/`);
    const outside = (await page.evaluate(`[...document.querySelectorAll("a, button")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; }).map((el) => el.textContent.trim())`)) as string[];
    assert.deepEqual(outside, [], `at ${width}px`);
    assert.equal(await page.evaluate("document.documentElement.scrollWidth"), width, `the page is wider than ${width}px`);
  }
  await page.setViewportSize({ width: 1024, height: 800 });
  await assertAccessible(page, "the dashboard at a laptop's width");
});

test("the top bar's search box finds a record, by keyboard alone", async () => {
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  unwrap(crm.createClient(t.services.crm, mikey, { name: "Elk River Diner" }));
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${t.origin}/`);
  await page.getByLabel("Email").fill("mikey@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.getByRole("searchbox", { name: "Search HQ" }).fill("elk diner");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.pathname === "/search");
  await page.getByRole("link", { name: "Elk River Diner" }).waitFor();
  await assertAccessible(page, "search results");
  await page.emulateMedia({ colorScheme: "dark" });
  await assertAccessible(page, "search results in dark");
  await page.goto(`${t.origin}/search?q=zzqqxx`);
  await assertAccessible(page, "a search with no results");
});
