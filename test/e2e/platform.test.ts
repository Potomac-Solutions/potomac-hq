// Scaffold check: the end-to-end runner can drive a real browser. Replace with
// workflow tests from v0.2 on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";

test("a browser opens and renders a page", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<main><h1>Potomac HQ</h1></main>");
    assert.equal(await page.locator("h1").textContent(), "Potomac HQ");
  } finally {
    await browser.close();
  }
});
