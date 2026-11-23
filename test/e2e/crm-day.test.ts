// The day-to-day CRM in a real browser: log a call on an opportunity with the
// next follow-up, add a to-do there, and tick to-dos off on the To-dos page.
// Each screen is checked for accessibility.
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import * as crm from "../../src/crm/index.ts";
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

test("log a voicemail, set the follow-up, add a to-do and tick it off", async () => {
  const page = await (await browser.newContext()).newPage();
  await setUpAdmin(t, page);
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const client = unwrap(crm.createClient(t.services.crm, mikey, { name: "Gormania Feed", sizeTier: "small" }));
  unwrap(crm.addContact(t.services.crm, mikey, client.id, { name: "Bob Miller", email: "bob@feed.example", isPrimary: true }));
  const opportunity = unwrap(crm.createOpportunity(t.services.crm, mikey, client.id, { title: "New website", leadSource: "referral" }));
  await page.goto(`${t.origin}/opportunities/${opportunity.id}`);
  await page.getByLabel("If a call, how it went").selectOption("voicemail");
  await page.getByLabel("With", { exact: true }).selectOption({ label: "Bob Miller" });
  await page.getByLabel("Next follow-up (optional)").fill(Temporal.Now.plainDateISO("America/New_York").add({ days: 2 }).toString());
  await page.getByRole("button", { name: "Log it" }).click();
  await page.getByText("Call, left a voicemail with Bob Miller").waitFor();
  await page.getByText("Add a to-do").click();
  await page.getByLabel("What needs doing").fill("Send Bob the mock-up");
  await page.getByRole("button", { name: "Add it" }).click();
  await page.getByText("Send Bob the mock-up").first().waitFor();
  await assertAccessible(page, "an opportunity with a call and a to-do");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(`${t.origin}/todos`);
    await page.getByRole("heading", { name: "Whenever" }).waitFor();
    await assertAccessible(page, `to-dos (${colorScheme})`);
  }
  await page.getByRole("button", { name: "Done: Send Bob the mock-up" }).click();
  await page.getByRole("heading", { name: "Done this week" }).waitFor();
  await assertAccessible(page, "to-dos with one done");
});
