// Booking in a real browser: setting the hours, then the Calls page. Each
// screen is checked for accessibility, in light and dark.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { saveBookingSetup } from "../../src/booking/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin } from "../support/browser.ts";
import { TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";

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

test("a prospect books from the public page on a phone, then sees their call's page", async () => {
  const page = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
  // Open to the public: weekdays, 9 to 12.
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const weekdays = Object.fromEntries([1, 2, 3, 4, 5].flatMap((day) => [[`start-${day}-0`, "09:00"], [`end-${day}-0`, "12:00"]]));
  unwrap(saveBookingSetup(t.services.booking, mikey, { ...weekdays, "call-minutes": "30", "gap-minutes": "15", "notice-hours": "24", "days-ahead": "21", "public-open": "1" }));

  await page.goto(`${t.origin}/book`);
  await page.getByRole("heading", { name: "Book a call with Potomac Solutions" }).waitFor();
  const size = (await page.evaluate("({ page: document.documentElement.scrollWidth, screen: window.innerWidth })")) as { page: number; screen: number };
  assert.ok(size.page <= size.screen, `the booking page is ${size.page}px wide on a ${size.screen}px phone`);
  await assertAccessible(page, "the public booking page on a phone");
  await page.getByLabel("Your name").fill("Dale Pruitt");
  await page.getByLabel("Your email").fill("dale@example.com");
  await page.getByLabel("What would you like to talk about?").fill("A website for the farm stand");
  await page.getByRole("button", { name: /^Book .*, 9:00 AM$/ }).first().click();
  await page.getByText("You’re booked. We’ll talk then.").waitFor();
  await assertAccessible(page, "a booked call's own page");
  await page.emulateMedia({ colorScheme: "dark" });
  await assertAccessible(page, "a booked call's own page in dark");
});
