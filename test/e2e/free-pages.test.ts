// Free landing pages in a real browser (decision 0010, slice 4): a client
// asks for theirs and sends a round from a phone; Potomac sets it up and sees
// the round. Each screen is checked for accessibility, light and dark.
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

test("a client asks for their page and sends a round; Potomac sets it up", async () => {
  const staff = await (await browser.newContext()).newPage();
  const problems = watch(staff);
  await setUpAdmin(t, staff);
  const mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const moats = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Moats Hardware" })).id;
  const invited = await staff.request.post(`${t.origin}/clients/${moats}/portal-users`, { form: { name: "Rita Moats", email: "rita@example.com" }, headers: { origin: t.origin } });
  const token = /\/portal\/accept\?token=([A-Za-z0-9_-]{43})/.exec(await invited.text())?.[1] ?? "";

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const phoneProblems = watch(phone);
  await phone.goto(`${t.origin}/portal/accept?token=${token}`);
  await phone.getByLabel(/Choose a password/).fill(PASSWORD);
  await phone.getByRole("button", { name: "Save and sign in" }).click();
  await phone.waitForURL((url) => url.pathname === "/portal");
  await phone.getByRole("link", { name: "Ask for your free page" }).click();
  await assertAccessible(phone, "portal, free landing page, not asked for");
  await phone.getByRole("button", { name: "Ask for my free page" }).click();
  await phone.getByText("Asked.").waitFor();
  await assertAccessible(phone, "portal, free landing page, asked for");

  await staff.goto(`${t.origin}/clients/${moats}`);
  await staff.getByRole("link", { name: "Open the landing page" }).click();
  await staff.getByRole("textbox", { name: /^Address/ }).fill("moats-hardware");
  await staff.getByLabel("Where it stands").selectOption("in-review");
  await staff.getByRole("button", { name: "Save" }).click();
  await staff.getByText("Saved.").waitFor();

  await phone.reload();
  await phone.getByLabel("What you’d like changed").fill("A bigger phone number at the top, please.");
  await phone.getByRole("button", { name: "Send" }).click();
  await phone.getByText("That’s round 1.").waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await phone.emulateMedia({ colorScheme });
    await phone.reload();
    await assertAccessible(phone, `portal, free landing page with a round (${colorScheme})`);
  }
  assert.deepEqual(phoneProblems, []);

  for (const colorScheme of ["light", "dark"] as const) {
    await staff.emulateMedia({ colorScheme });
    await staff.reload();
    await assertAccessible(staff, `a client's free landing page (${colorScheme})`);
  }
  assert.match(await text(staff), /A bigger phone number at the top, please\./);
  await staff.getByRole("link", { name: "Landing pages" }).click();
  await staff.getByRole("heading", { name: "Free landing pages" }).waitFor();
  await assertAccessible(staff, "free landing pages");
  assert.deepEqual(problems, []);
});
