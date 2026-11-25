// Referral credit in a real browser (decision 0013, slice 8): make a client
// their own link, take earned credit off one of their draft invoices, and
// see the link in their portal. Each screen is checked for accessibility.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import * as finance from "../../src/finance/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { PASSWORD, TEST_PASSWORD_COST, testApp, unwrap, wonProject, type TestApp } from "../support/harness.ts";

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

test("a client's own link, their credit taken off an invoice, and the link in their portal", async () => {
  const staff = await (await browser.newContext()).newPage();
  const problems = watch(staff);
  await setUpAdmin(t, staff);
  const mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const moats = await wonProject(t.services, mikeyId, { client: "Moats Hardware", title: "Website plan", pricing: "monthly", amount: "50" });
  const other = await wonProject(t.services, mikeyId, { client: "Pruitt Farm Stand", title: "Farm stand site" });
  // Pruitt was referred by Moats and has earned Moats a credit.
  t.db.prepare("insert into referral_credit (id, referrer_id, referred_id, amount_minor, earned_at) values ('11111111-1111-4111-8111-000000000009', ?, ?, 2500, '2026-11-01T12:00:00Z')").run(moats.client.id, other.client.id);

  await staff.goto(`${t.origin}/clients/${moats.client.id}`);
  await staff.getByRole("button", { name: "Make them their own referral link" }).click();
  await staff.getByText("Made.").waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await staff.emulateMedia({ colorScheme });
    await staff.reload();
    await assertAccessible(staff, `a client with referrals (${colorScheme})`);
  }
  const draft = unwrap(finance.createInvoice(t.services.finance, mikeyId, moats.project.id, { kind: "other", description: "Website plan, December", amount: "50" }));
  await staff.goto(`${t.origin}/invoices/${draft.id}`);
  await staff.getByRole("button", { name: "Take $25.00 of referral credit off" }).click();
  await staff.getByText("Took $25.00 of referral credit off.").waitFor();
  await assertAccessible(staff, "an invoice with referral credit taken off");
  assert.match(await text(staff), /Referral credit: thank you for sending a friend our way\s*-\$25\.00/);
  await staff.goto(`${t.origin}/referrals`);
  await assertAccessible(staff, "referral links with the credit setting");

  const invited = await staff.request.post(`${t.origin}/clients/${moats.client.id}/portal-users`, { form: { name: "Rita Moats", email: "rita@example.com" }, headers: { origin: t.origin } });
  const token = /\/portal\/accept\?token=([A-Za-z0-9_-]{43})/.exec(await invited.text())?.[1] ?? "";
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const phoneProblems = watch(phone);
  await phone.goto(`${t.origin}/portal/accept?token=${token}`);
  await phone.getByLabel(/Choose a password/).fill(PASSWORD);
  await phone.getByRole("button", { name: "Save and sign in" }).click();
  await phone.getByRole("heading", { name: "Send a friend our way" }).waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await phone.emulateMedia({ colorScheme });
    await phone.reload();
    await assertAccessible(phone, `the portal with a referral link (${colorScheme})`);
  }
  assert.deepEqual(phoneProblems, []);
  assert.deepEqual(problems, []);
});
