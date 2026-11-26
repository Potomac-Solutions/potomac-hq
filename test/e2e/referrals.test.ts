// Referral links in a real browser: make a link, see its QR code, scan it,
// and send an inquiry that is credited to it. Each screen is checked for
// accessibility.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { assertAccessible, setUpAdmin, sidebar, text, watch } from "../support/browser.ts";
import { TEST_PASSWORD_COST, testApp, type TestApp } from "../support/harness.ts";

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

test("make a link, scan it, and see the inquiry it led to", async () => {
  const page = await (await browser.newContext()).newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  await sidebar(page, "Referral links");
  await page.getByRole("heading", { name: "No referral links yet" }).waitFor();
  await assertAccessible(page, "referral links, empty");
  await page.getByLabel("What it’s printed on").fill("Business cards, winter 2026");
  await page.getByLabel("Where a scan goes").fill("/contact");
  await page.getByLabel("Code").fill("card");
  await page.getByRole("button", { name: "Make link" }).click();
  await page.getByText("Link made.").waitFor();
  const code = page.getByRole("img", { name: "QR code for https://hq.example/r/card" });
  await code.waitFor();
  assert.ok(await code.evaluate((img) => { const picture = img as unknown as { complete: boolean; naturalWidth: number }; return picture.complete && picture.naturalWidth > 0; }), "the QR code loads");

  // Someone scans the card on their phone and writes in.
  // A headless browser says so, and would rightly not be counted: say what a phone says.
  const userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 }, userAgent })).newPage();
  await phone.goto(`${t.origin}/r/card`);
  await phone.waitForURL((url) => url.pathname === "/contact" && url.searchParams.get("ref") === "card");
  await phone.getByLabel("Your name").fill("Rita Okafor");
  await phone.getByLabel("Your email").fill("rita@example.com");
  await phone.getByLabel("Your message").fill("Saw your card at the diner. We need a menu page.");
  await phone.getByRole("button", { name: "Send" }).click();
  await phone.getByRole("heading", { name: "Thanks" }).waitFor();

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(`${t.origin}/referrals`);
    await page.getByRole("heading", { name: "1 scan, 1 inquiry" }).waitFor();
    await assertAccessible(page, `referral links (${colorScheme})`);
  }
  assert.match(await text(page), /1 of 1 scan led to an inquiry \(100%\)/);
  await page.getByRole("link", { name: "Inquiry: Saw your card at the diner" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/opportunities/"));
  assert.deepEqual(problems, []);
});
