// Paying an invoice by card in a real browser (decision 0018), in test mode:
// the button, HQ's step that sends the browser on to the platform's page
// (a redirect can't: HQ's forms may only go to HQ), and back, paid. On a
// phone, checked for accessibility.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, watch } from "../support/browser.ts";
import { PASSWORD, TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";

let t: TestApp;
let browser: Browser;
let staff: Page;
before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, cardPay: { platform: "test", settings: {} } });
  browser = await chromium.launch();
  staff = await (await browser.newContext()).newPage();
  await setUpAdmin(t, staff);
});
after(async () => {
  await browser?.close();
  await t.stop();
});

test("a client pays an invoice by card from a phone", async () => {
  const mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const moats = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Moats Hardware" })).id;
  const invited = await staff.request.post(`${t.origin}/clients/${moats}/portal-users`, { form: { name: "Rita Moats", email: "rita@example.com" }, headers: { origin: t.origin } });
  const token = /\/portal\/accept\?token=([A-Za-z0-9_-]{43})/.exec(await invited.text())?.[1] ?? "";
  await staff.request.post(`${t.origin}/clients/${moats}/invoices`, { form: { kind: "other", description: "Domain, a year", amount: "42.50", send: "on" }, headers: { origin: t.origin } });

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const problems = watch(phone);
  await phone.goto(`${t.origin}/portal/accept?token=${token}`);
  await phone.getByLabel(/Choose a password/).fill(PASSWORD);
  await phone.getByRole("button", { name: "Save and sign in" }).click();
  await phone.waitForURL((url) => url.pathname === "/portal");
  await assertAccessible(phone, "portal with an invoice to pay by card");

  // The button goes to HQ's step, and the browser goes on by itself to the platform's page.
  await phone.getByRole("button", { name: /Pay by card/ }).click();
  await phone.waitForURL((url) => url.pathname === "/pay/test");
  await phone.getByText("$42.50").waitFor();
  await phone.getByRole("button", { name: "Pay", exact: true }).click();
  await phone.waitForURL((url) => url.pathname === "/portal");
  await phone.getByText("Paid. Thank you.").first().waitFor();
  assert.equal(await phone.getByRole("button", { name: /Pay by card/ }).count(), 0);
  assert.equal(t.db.prepare("select count(*) as n from payment where method = 'card'").get()?.["n"], 1);
  assert.deepEqual(problems, []);
});

test("the step before the platform, when a browser doesn't go on by itself: the amount and one link, accessible", async () => {
  const mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const hill = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Hillside Farm" })).id;
  const admin = staff;
  const invited = await admin.request.post(`${t.origin}/clients/${hill}/portal-users`, { form: { name: "Ada Hill", email: "ada@example.com" }, headers: { origin: t.origin } });
  const token = /\/portal\/accept\?token=([A-Za-z0-9_-]{43})/.exec(await invited.text())?.[1] ?? "";
  const made = await admin.request.post(`${t.origin}/clients/${hill}/invoices`, { form: { kind: "other", description: "Logo", amount: "80", send: "on" }, headers: { origin: t.origin }, maxRedirects: 0 });
  const id = /\/invoices\/([0-9a-f-]{36})/.exec(made.headers()["location"] ?? "")?.[1] ?? "";

  const page = await (await browser.newContext()).newPage();
  await page.goto(`${t.origin}/portal/accept?token=${token}`);
  await page.getByLabel(/Choose a password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Save and sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/portal");
  await page.request.post(`${t.origin}/portal/invoices/${id}/pay`, { form: { from: "test" }, headers: { origin: t.origin }, maxRedirects: 0 });
  // Hold the page where it is: answer the step without its Refresh header.
  await page.route(`**/portal/invoices/${id}/pay`, async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers["refresh"];
    await route.fulfill({ response, headers });
  });
  await page.goto(`${t.origin}/portal/invoices/${id}/pay`);
  await page.getByRole("heading", { name: /Pay invoice INV-/ }).waitFor();
  await page.getByText("$80.00").waitFor();
  await assertAccessible(page, "the step before the payment platform");
  await page.unroute(`**/portal/invoices/${id}/pay`);
  await page.getByRole("link", { name: "Continue to the test page" }).click();
  await page.waitForURL((url) => url.pathname === "/pay/test");
});
