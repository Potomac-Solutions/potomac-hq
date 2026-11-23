// Two-factor sign-in in a real browser: turning it on from Settings with a
// code, then signing in again with the password and a code. Each screen is
// checked for accessibility.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { codeAt, stepOf } from "../../src/identity/adapters.ts";
import { assertAccessible, setUpAdmin } from "../support/browser.ts";
import { PASSWORD, TEST_PASSWORD_COST, testApp, type TestApp } from "../support/harness.ts";

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

const secret = () => String(t.db.prepare("select secret from user_two_factor").get()?.["secret"] ?? "");

test("turn it on in Settings, then sign in with the password and a code", async () => {
  const page = await (await browser.newContext()).newPage();
  await setUpAdmin(t, page);
  await page.goto(`${t.origin}/settings`);
  await page.getByRole("button", { name: "Turn on with an app" }).click();
  await page.getByLabel("Code from your app", { exact: true }).waitFor();
  await assertAccessible(page, "Settings, adding HQ to an app");
  await page.getByLabel("Code from your app", { exact: true }).fill(codeAt(secret(), stepOf(Date.now())));
  await page.getByRole("button", { name: "Turn it on" }).click();
  await page.getByRole("heading", { name: "Your recovery codes" }).waitFor();
  assert.equal(await page.locator(".codes code").count(), 10);
  await assertAccessible(page, "the recovery codes");
  await page.getByRole("link", { name: "I’ve saved them" }).click();
  await page.getByText("10 recovery codes are left.").waitFor();

  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto(`${t.origin}/`);
  await fresh.getByLabel("Email").fill("mikey@example.com");
  await fresh.getByLabel("Password").fill(PASSWORD);
  await fresh.getByRole("button", { name: "Sign in" }).click();
  await fresh.getByRole("heading", { name: "Confirm it’s you" }).waitFor();
  await assertAccessible(fresh, "the second step at sign-in");
  await fresh.getByLabel("Code").fill(codeAt(secret(), stepOf(Date.now()) + 1));
  await fresh.getByRole("button", { name: "Continue" }).click();
  await fresh.getByRole("heading", { name: "Dashboard" }).waitFor();
});
