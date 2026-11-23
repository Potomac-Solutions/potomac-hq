// The availability grid in a real browser: drag to paint the usual week with
// a mouse, tap on a phone, paint one week differently. Checked for
// accessibility in light and dark, and on a phone.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { assertAccessible, setUpAdmin, watch } from "../support/browser.ts";
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

async function drag(page: Page, from: string, to: string) {
  const a = await page.getByLabel(from, { exact: true }).boundingBox();
  const b = await page.getByLabel(to, { exact: true }).boundingBox();
  assert.ok(a && b);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test("drag to paint the usual week, then paint one week differently", async () => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  await page.goto(`${t.origin}/calls/hours`);
  // Monday to Friday, 9:00 to 11:00, in one drag.
  await drag(page, "Mondays, 9:00 AM to 9:30 AM", "Fridays, 10:30 AM to 11:00 AM");
  assert.equal(await page.getByLabel("Wednesdays, 10:00 AM to 10:30 AM", { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel("Saturdays, 10:00 AM to 10:30 AM", { exact: true }).isChecked(), false);
  // Drag again from a painted cell: the rectangle rubs out.
  await drag(page, "Wednesdays, 9:00 AM to 9:30 AM", "Wednesdays, 10:30 AM to 11:00 AM");
  assert.equal(await page.getByLabel("Wednesdays, 10:00 AM to 10:30 AM", { exact: true }).isChecked(), false);
  // A single click still toggles one cell, and so does the keyboard.
  await page.getByLabel("Saturdays, 9:00 AM to 9:30 AM", { exact: true }).click();
  await page.getByLabel("Saturdays, 9:30 AM to 10:00 AM", { exact: true }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Save my usual week" }).click();
  await page.getByText("Your usual week is saved.").waitFor();
  const hours = t.db.prepare("select weekday, start, end from booking_hours order by weekday, start").all().map((row) => ({ ...row }));
  assert.deepEqual(hours, [
    { weekday: 1, start: 540, end: 660 },
    { weekday: 2, start: 540, end: 660 },
    { weekday: 4, start: 540, end: 660 },
    { weekday: 5, start: 540, end: 660 },
    { weekday: 6, start: 540, end: 600 },
  ]);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.reload();
    await assertAccessible(page, `the usual week (${colorScheme})`);
  }
  await page.goto(`${t.origin}/calls/availability`);
  await page.getByRole("link", { name: "Next week →" }).click();
  await page.waitForURL(/week=/);
  await assertAccessible(page, "a week of availability");
  const monday = await page.locator("input.cell").first().getAttribute("name");
  assert.ok(monday);
  const day = monday.split("-").slice(1, 4).join("-");
  const label = await page.locator(`input[name="c-${day}-540"]`).getAttribute("aria-label");
  assert.ok(label);
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("button", { name: "Save this week" }).click();
  await page.getByText("Saved. Days painted differently").waitFor();
  assert.equal(t.db.prepare("select count(*) as n from booking_date where day = ?").get(day)?.["n"], 1);
  assert.deepEqual(problems, []);
});

test("on a phone, the grid scrolls inside its panel and a tap paints a cell", async () => {
  const page = await (await browser.newContext({ viewport: { width: 320, height: 700 }, hasTouch: true, isMobile: true })).newPage();
  await page.goto(`${t.origin}/`);
  await page.getByLabel("Email").fill("mikey@example.com");
  await page.getByLabel("Password").fill((await import("../support/harness.ts")).PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto(`${t.origin}/calls/hours`);
  assert.equal(await page.evaluate("document.documentElement.scrollWidth"), 320);
  const cell = page.getByLabel("Sundays, 9:00 AM to 9:30 AM", { exact: true });
  await cell.scrollIntoViewIfNeeded();
  await cell.tap();
  assert.equal(await cell.isChecked(), true);
  await assertAccessible(page, "the usual week on a phone");
});
