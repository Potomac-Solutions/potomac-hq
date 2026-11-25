// Monthly reports in a real browser (decision 0010, slice 5): draft last
// month's, read one and add a line; the client reads a sent one in the
// portal. Each screen is checked for accessibility, light and dark.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { PASSWORD, TEST_PASSWORD_COST, testApp, wonProject, type TestApp } from "../support/harness.ts";

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

test("draft, read and annotate a report; the client reads it once sent", async () => {
  const staff = await (await browser.newContext()).newPage();
  const problems = watch(staff);
  await setUpAdmin(t, staff);
  const mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const plan = await wonProject(t.services, mikeyId, { client: "Moats Hardware", title: "Website plan", pricing: "monthly", amount: "50" });
  await staff.goto(`${t.origin}/today`);
  await staff.getByRole("link", { name: "Monthly reports" }).click();
  await staff.getByRole("button", { name: "Draft last month’s missing reports now" }).click();
  await staff.getByText("Drafted 1 report.").waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await staff.emulateMedia({ colorScheme });
    await staff.reload();
    await assertAccessible(staff, `monthly reports (${colorScheme})`);
  }
  await staff.getByRole("link", { name: "Moats Hardware" }).click();
  await staff.getByLabel(/A line of your own/).fill("Thanks for a great year!");
  await staff.getByRole("button", { name: "Save line" }).click();
  await staff.getByText("Saved.").waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await staff.emulateMedia({ colorScheme });
    await staff.reload();
    await assertAccessible(staff, `a monthly report (${colorScheme})`);
  }
  assert.match(await text(staff), /Thanks for a great year!/);
  assert.deepEqual(problems, []);

  // Sent (email is off in this test, so marked sent directly), and read in the portal.
  t.db.prepare("update monthly_report set status = 'sent', sent_to = 'rita@example.com', sent_at = '2026-12-01T13:00:00Z'").run();
  const invited = await staff.request.post(`${t.origin}/clients/${plan.client.id}/portal-users`, { form: { name: "Rita Moats", email: "rita@example.com" }, headers: { origin: t.origin } });
  const token = /\/portal\/accept\?token=([A-Za-z0-9_-]{43})/.exec(await invited.text())?.[1] ?? "";
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const phoneProblems = watch(phone);
  await phone.goto(`${t.origin}/portal/accept?token=${token}`);
  await phone.getByLabel(/Choose a password/).fill(PASSWORD);
  await phone.getByRole("button", { name: "Save and sign in" }).click();
  await phone.waitForURL((url) => url.pathname === "/portal");
  await phone.getByRole("heading", { name: "Your monthly reports" }).waitFor();
  await phone.locator("#reports a").first().click();
  await phone.getByText("Thanks for a great year!").waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await phone.emulateMedia({ colorScheme });
    await phone.reload();
    await assertAccessible(phone, `a monthly report in the portal (${colorScheme})`);
  }
  assert.deepEqual(phoneProblems, []);
});
