// The top bar holds up to ten links and two buttons. At every width from a
// phone to a wide screen, nothing in it runs off the edge.
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
