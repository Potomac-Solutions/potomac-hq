// Demo tracking in a real browser (decision 0013, slice 9): add a demo, send
// it from an opportunity, open it on a phone, and see the open. Each screen
// is checked for accessibility, light and dark.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";

let t: TestApp;
let browser: Browser;
const sent: { body: string }[] = [];
before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: "https://hq.example", email: { publicUrl: "https://hq.example", send: async (message) => (sent.push(message), { ok: true }) } });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await t.stop();
});

test("add a demo, send it, and see it opened", async () => {
  const page = await (await browser.newContext()).newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  const mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const client = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Brenda’s Pizzeria" }));
  const contact = unwrap(crm.addContact(t.services.crm, mikeyId, client.id, { name: "Brenda Kight", email: "brenda@example.com", isPrimary: true }));
  const lead = unwrap(crm.createOpportunity(t.services.crm, mikeyId, client.id, { title: "Ordering site", leadSource: "phone", contactId: contact.id })).id;

  await page.getByRole("link", { name: "Demos" }).click();
  await page.getByRole("heading", { name: "No demos yet" }).waitFor();
  await assertAccessible(page, "demos, empty");
  await page.getByRole("textbox", { name: /^Name/ }).last().fill("Counter");
  await page.getByRole("textbox", { name: /^Address/ }).last().fill("https://counter.potomac.solutions");
  await page.getByRole("button", { name: "Add demo" }).click();
  await page.getByText("Added.").waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.reload();
    await assertAccessible(page, `demos (${colorScheme})`);
  }

  await page.goto(`${t.origin}/opportunities/${lead}`);
  await page.getByText("Send demos").click();
  await page.getByLabel("Counter").check();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByText("Sent 1 demo to brenda@example.com.").waitFor();
  const code = /https:\/\/hq\.example(\/d\/[a-z2-9]{8})/.exec(sent.at(-1)?.body ?? "")?.[1] ?? "";
  await fetch(`${t.origin}${code}`, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)" } });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.reload();
    await assertAccessible(page, `an opportunity with a demo opened (${colorScheme})`);
  }
  assert.match(await text(page), /Counter\s*, sent .*: opened once/);
  await page.goto(`${t.origin}/today`);
  await page.getByText("Brenda Kight looked at Counter: follow up").first().waitFor();
  await assertAccessible(page, "today with a demo to follow up");
  assert.deepEqual(problems, []);
});
