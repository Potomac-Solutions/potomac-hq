// The first slice in a real browser: prospect, contact, opportunity,
// follow-up, project. Every screen is checked by axe, and the same forms are
// used with JavaScript turned off.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createApp, type App } from "../../src/app.ts";
import { migrate, openDatabase, readMigrations, systemClock, type Database } from "../../src/shared/adapters.ts";

const PASSWORD = "correct horse battery";

let dir: string;
let db: Database;
let app: App;
let server: Server;
let origin: string;
let browser: Browser;
let signedIn: BrowserContext;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "hq-e2e-crm-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db, readMigrations(join(import.meta.dirname, "..", "..", "migrations")), systemClock);
  app = await createApp({ db, secure: false, proxies: 0, noticeSecret: "e2e-crm-secret-e2e-crm-secret-000000" });
  server = createServer(app.listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function assertAccessible(page: Page, screen: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const found = results.violations.map(
    (violation) => `${violation.id}: ${violation.help} [${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}]`,
  );
  assert.deepEqual(found, [], `accessibility problems on ${screen}`);
}

async function text(page: Page, selector = "main"): Promise<string> {
  return ((await page.textContent(selector)) ?? "").replace(/\s+/g, " ");
}

test("prospect to project, through the pages", async () => {
  signedIn = await browser.newContext();
  const page = await signedIn.newPage();
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));

  // The first admin.
  const setup = await app.setupPath();
  assert.ok(setup);
  await page.goto(origin + setup);
  await page.getByLabel("Your email").fill("mikey@example.com");
  await page.getByLabel("Your name").fill("Mikey Nichols");
  await page.getByLabel(/Choose a password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Make my account" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.getByRole("heading", { name: "Follow-ups due" }).waitFor();

  // Clients, from the shell's navigation: open the Clients hub, then its page.
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.locator("summary", { hasText: "Clients" }).click();
  await nav.getByRole("link", { name: "Clients", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/clients");
  assert.match(await text(page), /No clients yet/);
  await assertAccessible(page, "the clients page");

  const newClient = page.locator('form[action="/clients"]');
  await newClient.getByLabel("Business name").fill("Mt. Storm Bakery");
  await newClient.getByLabel("Size").selectOption("small");
  await newClient.getByLabel("Website").fill("mtstormbakery.com");
  await newClient.getByRole("button", { name: "Add client" }).click();
  await page.waitForURL((url) => /^\/clients\/[0-9a-f-]{36}$/.test(url.pathname));
  await page.getByRole("heading", { name: "Mt. Storm Bakery", level: 1 }).waitFor();
  assert.match(await text(page, "[role=status]"), /Client added/);
  await assertAccessible(page, "a client's page");

  // A contact.
  const newContact = page.locator('form[action$="/contacts"]');
  await newContact.getByLabel("Name").fill("Ann Baker");
  await newContact.getByLabel("Email").fill("ann@example.com");
  await newContact.getByLabel("Title").fill("Owner");
  await newContact.getByLabel("Primary contact").check();
  await newContact.getByRole("button", { name: "Add contact" }).click();
  await page.waitForURL((url) => url.searchParams.has("done"));
  assert.match(await text(page, "section[aria-labelledby=client-contacts] table"), /Ann Baker Primary/);

  // An opportunity.
  const newOpportunity = page.locator('form[action$="/opportunities"]');
  await newOpportunity.getByLabel("Title").fill("Bakery website");
  await newOpportunity.getByLabel("Service").selectOption("website");
  await newOpportunity.getByLabel("How they found you").selectOption("word-of-mouth");
  await newOpportunity.getByLabel("Contact").selectOption({ label: "Ann Baker" });
  await newOpportunity.getByRole("button", { name: "Open opportunity" }).click();
  await page.waitForURL((url) => /^\/opportunities\/[0-9a-f-]{36}$/.test(url.pathname));
  await page.getByRole("heading", { name: "Bakery website", level: 1 }).waitFor();
  await assertAccessible(page, "an opportunity's page");
  const opportunityUrl = page.url().split("?")[0] ?? "";

  // A follow-up today shows on the dashboard.
  const today = Temporal.Now.plainDateISO("America/New_York").toString();
  await page.getByLabel("Follow up on").fill(today);
  await page.getByRole("button", { name: "Save follow-up" }).click();
  await page.waitForURL((url) => url.searchParams.has("done"));
  assert.match(await text(page, "section[aria-labelledby=opportunity-details]"), /Due/);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  assert.match(await text(page, "section[aria-labelledby=follow-ups-due]"), /Bakery website · Mt\. Storm Bakery/);
  await assertAccessible(page, "the dashboard with a follow-up due");
  await page.goto(opportunityUrl);

  // Move it on. A quote needs a price first.
  for (const stage of ["Consult booked", "Consulted"]) {
    await page.getByRole("button", { name: `Move to ${stage}` }).click();
    await page.waitForURL((url) => url.searchParams.has("done"));
  }
  await page.getByRole("button", { name: "Move to Quoted" }).click();
  await page.waitForURL((url) => url.searchParams.has("problem"));
  assert.match(await text(page, "[role=alert]"), /needs a price first/);
  await assertAccessible(page, "an opportunity's page with an error");

  await page.getByLabel("How it is priced").selectOption("monthly");
  await page.getByLabel("Amount in dollars").fill("50");
  await page.getByRole("button", { name: "Save price" }).click();
  await page.waitForURL((url) => url.searchParams.has("done"));
  assert.match(await text(page, "section[aria-labelledby=opportunity-details]"), /\$50\.00 a month/);

  for (const stage of ["Quoted", "Won"]) {
    await page.getByRole("button", { name: `Move to ${stage}` }).click();
    await page.waitForURL((url) => url.searchParams.has("done"));
  }
  assert.equal(await page.locator("section[aria-labelledby=opportunity-details] strong").textContent(), "Won");

  // The project.
  await page.getByRole("button", { name: "Start the project" }).click();
  await page.waitForURL((url) => /^\/projects\/[0-9a-f-]{36}$/.test(url.pathname));
  await page.getByRole("heading", { name: "Bakery website", level: 1 }).waitFor();
  assert.match(await text(page), /Ongoing plan/);
  await assertAccessible(page, "a project's page");

  // The client is now active, and the dashboard shows what happened.
  await page.goto(origin + "/clients");
  const row = page.getByRole("row", { name: /Mt\. Storm Bakery/ });
  // An admin's list starts with a tick box to pick rows for deleting (decision 0023), so Status is the third cell.
  assert.equal(await row.getByRole("cell").nth(2).textContent(), "Active");
  await page.goto(origin + "/");
  assert.match(await text(page, "section[aria-labelledby=recent-activity]"), /Mikey Nichols started a project/);
  assert.doesNotMatch(await text(page, "section[aria-labelledby=follow-ups-due]"), /Bakery website/, "a won deal's follow-up is no longer due");

  // The pipeline: a second deal, moved on from its card.
  await page.goto(origin + "/clients");
  await page.getByRole("link", { name: "Mt. Storm Bakery" }).click();
  const another = page.locator('form[action$="/opportunities"]');
  await another.getByLabel("Title").fill("Online ordering app");
  await another.getByLabel("Service").selectOption("application");
  await another.getByRole("button", { name: "Open opportunity" }).click();
  await page.waitForURL((url) => /^\/opportunities\//.test(url.pathname));
  await page.getByRole("link", { name: "Pipeline" }).click();
  await page.waitForURL((url) => url.pathname === "/pipeline");
  await assertAccessible(page, "the pipeline");
  await page.getByRole("button", { name: "Move to Consult booked: Online ordering app" }).click();
  await page.waitForURL((url) => url.pathname === "/pipeline" && url.searchParams.has("done"));
  assert.match(await text(page, "section[aria-labelledby=stage-consult-booked]"), /Online ordering app/);

  assert.deepEqual(problems, []);
  await page.close();
});

test("the forms work with JavaScript turned off", async () => {
  const state = await signedIn.storageState();
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: state });
  const page = await context.newPage();
  await page.goto(origin + "/clients");
  const form = page.locator('form[action="/clients"]');
  await form.getByLabel("Business name").fill("Romney Gas & Go");
  await form.getByLabel("Size").selectOption("small");
  await form.getByRole("button", { name: "Add client" }).click();
  await page.waitForURL((url) => /^\/clients\/[0-9a-f-]{36}$/.test(url.pathname));
  await page.getByRole("heading", { name: "Romney Gas & Go", level: 1 }).waitFor();
  await context.close();
});
