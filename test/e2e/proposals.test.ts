// v0.4 in a real browser: draft a proposal from an opportunity, send it,
// download the PDF, record the answer, and land on a project with a baseline.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { testApp, unwrap, type TestApp } from "../support/harness.ts";

let t: TestApp;
let browser: Browser;

before(async () => {
  t = await testApp();
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await t.stop();
});

test("a proposal, from the opportunity to an accepted project", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const client = unwrap(crm.createClient(t.services.crm, mikey, { name: "Mt. Storm Bakery" }));
  const opportunity = unwrap(crm.createOpportunity(t.services.crm, mikey, client.id, { title: "Bakery ordering app", leadSource: "phone", service: "application" }));
  for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(t.services.crm, mikey, opportunity.id, { to }));

  await page.goto(`${t.origin}/proposals`);
  await assertAccessible(page, "the empty proposals list");

  // Start it from the opportunity.
  await page.goto(`${t.origin}/opportunities/${opportunity.id}`);
  await assertAccessible(page, "an opportunity with the proposals panel");
  await page.getByRole("button", { name: "Start a proposal" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/proposals/"));
  await page.getByText("Proposal drafted.").waitFor();
  await assertAccessible(page, "a draft proposal");

  // Change a line and add one.
  await page.getByLabel("Hours or quantity, line 2").fill("18");
  await page.getByLabel("Item, line 4").fill("Stock photos");
  await page.getByLabel("Counted in, line 4").selectOption("quantity");
  await page.getByLabel("Hours or quantity, line 4").fill("3");
  await page.getByLabel("Rate in dollars, line 4").fill("12.50");
  await page.getByRole("button", { name: "Save proposal" }).click();
  await page.getByText("Proposal saved.").waitFor();
  assert.match(await text(page), /Total ?\$2,287\.50/);

  // Send it and read what the client gets.
  await page.getByRole("button", { name: "Send as version 1" }).click();
  await page.waitForURL((url) => url.pathname.endsWith("/versions/1"));
  await assertAccessible(page, "a sent version");
  assert.match(await text(page), /Prepared for Mt\. Storm Bakery/);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download the PDF" }).click()]);
  assert.equal(download.suggestedFilename(), "Bakery-ordering-app-proposal-v1.pdf");

  // Record the answer.
  await page.getByRole("link", { name: "Bakery ordering app" }).click();
  await page.waitForURL((url) => /^\/proposals\/[0-9a-f-]{36}$/.test(url.pathname));
  await assertAccessible(page, "a sent proposal");
  await page.getByLabel("Who gave the answer").fill("Ann Baker");
  await page.getByLabel("How the answer was given").selectOption("signed-paper");
  await page.getByRole("button", { name: "Record answer" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/projects/"));
  await page.getByText("Answer recorded.").waitFor();
  assert.match(await text(page), /What was agreed ?\$2,287\.50/);
  await assertAccessible(page, "a project with a baseline");

  // The accepted proposal, and the list.
  await page.getByRole("link", { name: /the accepted proposal, version 1/ }).click();
  await page.waitForURL((url) => url.pathname.endsWith("/versions/1"));
  await page.getByRole("link", { name: "Proposals", exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === "/proposals");
  assert.match(await text(page), /Bakery ordering app ?Mt\. Storm Bakery ?Accepted/);
  await assertAccessible(page, "the proposals list");
  await page.getByRole("link", { name: "Bakery ordering app" }).click();
  await page.getByRole("heading", { name: "Signed agreement" }).waitFor();
  await assertAccessible(page, "an accepted proposal");

  assert.deepEqual(problems, []);
  await context.close();
});
