// Renewals in a real browser: add one on a client's page, then see it on
// Renewals and the dashboard. Each screen is checked for accessibility.
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import * as crm from "../../src/crm/index.ts";
import * as renewals from "../../src/renewals/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin } from "../support/browser.ts";
import { PASSWORD, TEST_PASSWORD_COST, testApp, unwrap, wonProject, type TestApp } from "../support/harness.ts";

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

test("add a domain on a client's page, and see it coming up", async () => {
  const page = await (await browser.newContext()).newPage();
  await setUpAdmin(t, page);
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const client = unwrap(crm.createClient(t.services.crm, mikey, { name: "Gormania Feed", sizeTier: "small" }));
  await page.goto(`${t.origin}/clients/${client.id}`);
  await page.getByText("Add a renewal").click();
  await page.getByLabel("What it’s called").fill("feedstore.com");
  await page.getByLabel("Renews on").fill(Temporal.Now.plainDateISO("America/New_York").add({ days: 12 }).toString());
  await page.getByLabel("What it costs us, in dollars").fill("10.44");
  await page.getByRole("button", { name: "Add renewal" }).click();
  await page.getByText("Added. It shows on the dashboard").waitFor();
  await page.getByLabel("Website address").fill("feedstore.com");
  await page.getByRole("button", { name: "Watch this site" }).click();
  await page.getByText("Watching it.").waitFor();
  await assertAccessible(page, "a client with a renewal and a site");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(`${t.origin}/renewals`);
    await page.getByRole("heading", { name: "In the next 30 days" }).waitFor();
    await assertAccessible(page, `renewals (${colorScheme})`);
    await page.goto(`${t.origin}/money/profit`);
    await page.getByRole("heading", { name: "By month" }).waitFor();
    await assertAccessible(page, `profit and loss (${colorScheme})`);
    await page.goto(`${t.origin}/sites`);
    await page.getByRole("heading", { name: "1 watched, 1 not checked yet" }).waitFor();
    await assertAccessible(page, `sites (${colorScheme})`);
    await page.goto(`${t.origin}/`);
    await page.getByRole("heading", { name: "Renewals in the next 30 days" }).waitFor();
    await assertAccessible(page, `the dashboard with a renewal (${colorScheme})`);
  }
});

test("bill a client for their domain from their page, and they see it in their portal", async () => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${t.origin}/`);
  await page.getByLabel("Email").fill("mikey@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const { client } = await wonProject(t.services, mikey, { client: "Better Days Towing", title: "Website rebuild" });
  const renewsOn = Temporal.Now.plainDateISO("America/New_York").add({ days: 9 }).toString();
  unwrap(renewals.addRenewal(t.services.renewals, mikey, client.id, { kind: "domain", name: "betterdaystowing.com", renewsOn, termMonths: "12", price: "20" }));

  await page.goto(`${t.origin}/clients/${client.id}#renewals`);
  await page.getByText("Not billed yet.").waitFor();
  await assertAccessible(page, "a client's renewal, not billed yet");
  await page.getByRole("button", { name: /^Bill the client \$20\.00/ }).click();
  await page.getByText("Billed. The invoice is in the client’s portal").waitFor();
  await page.getByText(/INV-0001 sent\. The client pays by/).waitFor();

  await page.getByText("Invite someone who isn’t a contact").click();
  await page.getByLabel("Their name").fill("Stacy Roberts");
  await page.getByLabel("Their email").fill("stacy@betterdays.example");
  await page.getByRole("button", { name: "Invite to the portal", exact: true }).click();
  const link = await page.getByLabel(/link/i).first().inputValue();
  const stacy = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  await stacy.goto(new URL(link, t.origin).href);
  await stacy.getByLabel(/Choose a password/).fill(PASSWORD);
  await stacy.getByRole("button", { name: "Save and sign in" }).click();
  await stacy.waitForURL((url) => url.pathname === "/portal");
  await stacy.getByRole("heading", { name: "Coming up for renewal" }).waitFor();
  await stacy.getByText(/Please pay INV-0001 by .+, a week before it renews, so we know to renew it\./).waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await stacy.emulateMedia({ colorScheme });
    await assertAccessible(stacy, `the portal with a renewal to pay (${colorScheme})`);
  }
});
