// A booking link in a real browser: Potomac makes one on the Calls page,
// and someone with no account opens it on a phone, says who they are and
// what the call is about, and chooses a time. Each screen is checked for
// accessibility.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { assertAccessible, setUpAdmin } from "../support/browser.ts";
import { saveWeeklyGrid } from "../../src/booking/index.ts";
import type { Id } from "../../src/shared/index.ts";
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

test("make a link on Calls; a visitor books with it on a phone, with no account", async () => {
  const page = await (await browser.newContext()).newPage();
  await setUpAdmin(t, page);
  // Free every weekday, 9:00 to 11:00.
  const me = t.db.prepare("select id from user").get()?.["id"] as Id;
  unwrap(saveWeeklyGrid(t.services.booking, me, Object.fromEntries([1, 2, 3, 4, 5].flatMap((d) => [540, 570, 600, 630].map((m) => [`c-${d}-${m}`, "1"])))));
  await page.goto(`${t.origin}/calls`);
  await page.getByLabel("Who it’s for").fill("Dana at Elk Diner");
  await page.getByRole("button", { name: "Make a link" }).click();
  const address = await page.getByLabel("Booking link for Dana at Elk Diner").inputValue();
  assert.match(address, /\/book\/with\/[A-Za-z0-9_-]{43}$/);
  await assertAccessible(page, "Calls, with a booking link");

  const phone = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
  await phone.goto(t.origin + new URL(address, t.origin).pathname);
  await phone.getByRole("heading", { name: "Book a call with Potomac Solutions" }).waitFor();
  await assertAccessible(phone, "booking with a link");
  assert.ok(Number(await phone.evaluate("document.documentElement.scrollWidth")) <= 360, "the page fits a phone");
  await phone.getByLabel("Your name").fill("Dana Reyes");
  await phone.getByLabel("Your business").fill("Elk Diner");
  await phone.getByLabel("Your email").fill("dana@elkdiner.example");
  await phone.getByLabel("Phone number").fill("304-555-0142");
  await phone.getByLabel("What would you like to talk about?").fill("Online orders for the diner.");
  await phone.locator(".book-times button").first().click();
  await phone.getByText("You’re booked. See you then.").waitFor();
  await phone.getByRole("heading", { name: "Your call with Potomac Solutions" }).waitFor();
  await assertAccessible(phone, "the booked call's own page");

  await page.reload();
  await page.getByText("Dana Reyes").first().waitFor();
  await page.getByText("Online orders for the diner.").first().waitFor();
});
