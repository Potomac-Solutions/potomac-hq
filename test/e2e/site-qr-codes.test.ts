// Client QR codes in a real browser (decision 0023): a client makes a code on
// their phone, in the portal, and its picture loads; their site reports a
// scan; the client and Potomac see the count. Each screen is checked for
// accessibility, light and dark.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { PASSWORD, TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";

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

test("a client makes a QR code for their own site and sees its scans; Potomac sees them and the script", async () => {
  const staff = await (await browser.newContext()).newPage();
  const problems = watch(staff);
  await setUpAdmin(t, staff);
  const mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const towing = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Better Days Towing" })).id;
  await staff.request.post(`${t.origin}/clients/${towing}/sites`, { form: { url: "betterdaystowing.com" }, headers: { origin: t.origin } });
  const invited = await staff.request.post(`${t.origin}/clients/${towing}/portal-users`, { form: { name: "Stacy Roberts", email: "stacy@example.com" }, headers: { origin: t.origin } });
  const token = /\/portal\/accept\?token=([A-Za-z0-9_-]{43})/.exec(await invited.text())?.[1] ?? "";

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const phoneProblems = watch(phone);
  await phone.goto(`${t.origin}/portal/accept?token=${token}`);
  await phone.getByLabel(/Choose a password/).fill(PASSWORD);
  await phone.getByRole("button", { name: "Save and sign in" }).click();
  await phone.waitForURL((url) => url.pathname === "/portal");
  await phone.getByRole("link", { name: "Make a QR code" }).click();
  await phone.getByRole("heading", { name: "No QR codes yet" }).waitFor();
  await assertAccessible(phone, "portal, QR codes, none yet");
  await phone.getByLabel("What it’s printed on").fill("Business cards, spring 2027");
  await phone.getByRole("textbox", { name: "Code (optional)" }).fill("card");
  await phone.getByRole("button", { name: "Make QR code" }).click();
  await phone.getByText("QR code made.").waitFor();
  const picture = phone.getByRole("img", { name: "QR code for https://betterdaystowing.com/?ref=card" });
  await picture.waitFor();
  assert.ok(await picture.evaluate((img) => { const shown = img as unknown as { complete: boolean; naturalWidth: number }; return shown.complete && shown.naturalWidth > 0; }), "the QR code loads");

  // Their site's script reports a scan, from a phone on their site.
  await fetch(`${t.origin}/hooks/site-qr`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://betterdaystowing.com", "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Version/18.1 Mobile/15E148 Safari/604.1" }, body: "code=card&kind=scan&v=abc123" });

  for (const colorScheme of ["light", "dark"] as const) {
    await phone.emulateMedia({ colorScheme });
    await phone.goto(`${t.origin}/portal/qr-codes`);
    await phone.getByRole("heading", { name: "1 scan, 1 in the last 30 days" }).waitFor();
    await assertAccessible(phone, `portal, QR codes with a scan (${colorScheme})`);
    await staff.emulateMedia({ colorScheme });
    await staff.goto(`${t.origin}/clients/${towing}/qr-codes`);
    await staff.getByRole("heading", { name: "The script for their website" }).waitFor();
    await assertAccessible(staff, `a client's QR codes (${colorScheme})`);
  }
  assert.match(await text(staff), /HQ last heard from their site/);
  assert.deepEqual(problems, []);
  assert.deepEqual(phoneProblems, []);
});
