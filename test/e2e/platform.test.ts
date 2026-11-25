// v1.0 in a real browser: invite a person, write and edit an article, read
// the audit history and the reports. Every screen gets the accessibility
// check, and the new ones are checked in dark too.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { readDocuments } from "../../src/knowledge/adapters.ts";
import { seedKnowledge } from "../../src/knowledge/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { PASSWORD, TEST_PASSWORD_COST, testApp, wonProject, type TestApp } from "../support/harness.ts";

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

test("people, the knowledge base, the audit history and reports", async () => {
  const page = await (await browser.newContext()).newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  await wonProject(t.services, mikey);
  seedKnowledge(t.services.knowledge, readDocuments(join(import.meta.dirname, "..", "..", "docs")));

  // People: invite Sam as a manager, and Sam uses the link.
  await page.goto(`${t.origin}/settings`);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "People" }).click();
  await page.waitForURL((url) => url.pathname === "/people");
  await assertAccessible(page, "People with one person");
  await page.getByText("Invite someone to HQ").click();
  await page.getByLabel("Their name").fill("Sam Helper");
  await page.getByLabel("Their email").fill("sam@example.com");
  await page.getByRole("group", { name: "Roles for the new person" }).getByLabel("Member").uncheck();
  await page.getByRole("group", { name: "Roles for the new person" }).getByLabel("Manager").check();
  await page.getByRole("button", { name: "Invite" }).click();
  await page.getByText("Send this link to Sam Helper").waitFor();
  await assertAccessible(page, "the one-time link for a new person");
  const link = await page.getByLabel(/link/i).first().inputValue();

  const sam = await (await browser.newContext()).newPage();
  await sam.goto(new URL(link, t.origin).href);
  await sam.getByLabel(/Choose a password/).fill(PASSWORD);
  await sam.getByRole("button", { name: /Make my account|Save|Sign in|Set/ }).first().click();
  await sam.waitForURL((url) => url.pathname === "/");
  assert.equal(await sam.getByRole("link", { name: "Reports", exact: true }).count(), 1, "a manager has Reports");

  await page.goto(`${t.origin}/people`);
  assert.match(await text(page), /Sam Helper sam@example\.com Manager · Active/);
  await page.getByText("Change Sam Helper").click();
  await page.getByRole("group", { name: "Roles for Sam Helper" }).getByLabel("Manager").uncheck();
  await page.getByRole("group", { name: "Roles for Sam Helper" }).getByLabel("Member").check();
  await page.getByRole("button", { name: "Save roles for Sam Helper" }).click();
  await page.getByText("Roles saved.").waitFor();
  await assertAccessible(page, "People with two people, after a change");
  const refused = await sam.goto(`${t.origin}/reports`);
  assert.equal(refused?.status(), 403, "the change applies to the next request");

  // The knowledge base: HQ's documents, a search, a new article, an edit.
  await page.getByRole("link", { name: "Knowledge" }).first().click();
  await page.waitForURL((url) => url.pathname === "/knowledge");
  await assertAccessible(page, "the knowledge base with HQ's documents");
  await page.getByLabel("Search for").fill("restore drill");
  await page.getByRole("button", { name: "Search" }).click();
  assert.match(await text(page), /Operations/);
  await page.goto(`${t.origin}/knowledge/authorization-matrix`);
  await assertAccessible(page, "a long article with tables");
  await page.goto(`${t.origin}/knowledge`);
  await page.getByText("New article or decision").click();
  await page.getByLabel("What is it?").selectOption("decision");
  await page.getByLabel("Title", { exact: true }).fill("Use Brevo for email");
  await page.getByLabel("Category", { exact: true }).fill("Decisions");
  await page.getByLabel(/^Tags/).fill("email");
  await page.getByLabel("Text", { exact: true }).fill("# Why\n\nIt has an API and a free tier.\n\n- Reset links\n- Alerts");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL((url) => url.pathname === "/knowledge/use-brevo-for-email");
  await assertAccessible(page, "a new decision");
  await page.getByText("Edit", { exact: true }).click();
  await page.getByLabel("Text", { exact: true }).fill("# Why\n\nIt has an API and a free tier.\n\n- Reset links\n- Invites\n- Alerts");
  await page.getByRole("button", { name: "Save as a new revision" }).click();
  await page.getByText("Saved as a new revision.").waitFor();
  await page.getByRole("link", { name: "Revision 1" }).click();
  await assertAccessible(page, "an older revision");
  assert.doesNotMatch(await text(page), /Invites/);

  // The audit history, filtered.
  await page.goto(`${t.origin}/activity`);
  await assertAccessible(page, "the audit history");
  await page.getByLabel("Action starts with").fill("article.");
  await page.getByRole("button", { name: "Show" }).click();
  assert.match(await text(page), /1 event Mikey Nichols edited an article/);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download these as CSV" }).click();
  assert.match((await download).suggestedFilename(), /^hq-audit-\d{4}-\d{2}-\d{2}\.csv$/);

  // Reports.
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/reports");
  await assertAccessible(page, "reports");
  assert.match(await text(page), /Win rate\s*100%/);

  // Dark.
  await page.emulateMedia({ colorScheme: "dark" });
  for (const [path, screen] of [["/reports", "reports"], ["/activity", "the audit history"], ["/people", "People"], ["/knowledge", "the knowledge base"], ["/knowledge/use-brevo-for-email", "an article"]] as const) {
    await page.goto(t.origin + path);
    await assertAccessible(page, `${screen} in dark`);
  }
  assert.deepEqual(problems, []);
});
