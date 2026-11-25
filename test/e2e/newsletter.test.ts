// The newsletter in a real browser (decision 0013, slice 2): someone signs up
// and confirms on a phone, then an admin writes an issue and sees it on its
// way. Each screen is checked for accessibility, light and dark.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { TEST_PASSWORD_COST, testApp, type TestApp } from "../support/harness.ts";

let t: TestApp;
let browser: Browser;
const mails: { to: string; body: string }[] = [];
before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: "https://hq.example", contact: { phone: "", email: "", address: "PO Box 1, Gormania, WV 26720" }, email: { publicUrl: "https://hq.example", send: async (message) => (mails.push(message), { ok: true }) } });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await t.stop();
});

test("sign up and confirm on a phone, then write and send an issue", async () => {
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const phoneProblems = watch(phone);
  await phone.goto(`${t.origin}/river?src=stop:lakes`);
  await assertAccessible(phone, "newsletter sign-up");
  await phone.getByLabel("Your email").fill("rita@example.com");
  await phone.getByLabel("Your first name").fill("Rita");
  await phone.getByRole("button", { name: "Sign me up" }).click();
  await phone.getByRole("heading", { name: "Check your email" }).waitFor();
  await assertAccessible(phone, "newsletter, check your email");
  const link = /https:\/\/hq\.example(\/river\/confirm\?t=[A-Za-z0-9_-]{43})/.exec(mails.at(-1)?.body ?? "")?.[1] ?? "";
  await phone.goto(`${t.origin}${link}`);
  await assertAccessible(phone, "newsletter, confirm");
  await phone.getByRole("button", { name: "Confirm" }).click();
  await phone.getByRole("heading", { name: "You’re on the list" }).waitFor();
  await assertAccessible(phone, "newsletter, on the list");
  assert.deepEqual(phoneProblems, []);

  const page = await (await browser.newContext()).newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  await page.getByRole("link", { name: "Newsletter" }).click();
  await page.getByRole("heading", { name: "Notes from the river" }).waitFor();
  assert.match(await text(page), /rita@example\.com\s*Rita\s*Lakes and outdoors/);
  await page.getByLabel("Subject").fill("Winter on the river");
  await page.getByLabel("What it says").fill("Hello from Gormania.");
  await page.getByLabel("Lakes and outdoors").check();
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByText("Saved as a draft.").waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.reload();
    await assertAccessible(page, `newsletter issue (${colorScheme})`);
  }
  await page.getByRole("button", { name: "Send to 1 reader" }).click();
  await page.getByText("Sending to 1 reader.").waitFor();
  await assertAccessible(page, "newsletter issue, going out");
  await page.getByRole("link", { name: "Newsletter" }).first().click();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.reload();
    await assertAccessible(page, `newsletter (${colorScheme})`);
  }
  assert.deepEqual(problems, []);
});
