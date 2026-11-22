// v0.5 in a real browser: the timer starts from the board, time is logged by
// hand, and a project's money is kept. Every screen is checked by axe.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { testApp, unwrap, wonProject, type TestApp } from "../support/harness.ts";

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

test("time and money for a project", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const { project } = await wonProject(t.services, mikey);
  unwrap(projects.addTask(t.services.projects, mikey, project.id, { title: "Draft the menu page", estimate: "2" }));

  // Dragging a card to "Working on" starts the timer.
  await page.goto(`${t.origin}/board`);
  await page.locator(".board-card", { hasText: "Draft the menu page" }).dragTo(page.locator("section.board-column", { has: page.getByRole("heading", { name: /^Working on/ }) }));
  await page.getByText("Task moved.").waitFor();
  await page.getByRole("link", { name: "Time", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/time");
  assert.match(await text(page), /Working on ?Draft the menu page · Bakery website/);
  await assertAccessible(page, "the Time page with a timer running");
  await page.getByRole("button", { name: "Stop the timer" }).click();
  await page.getByText("Timer stopped and the time logged.").waitFor();

  // Log time by hand.
  await page.getByLabel("Project or task").selectOption({ label: "Bakery website: Draft the menu page" });
  await page.getByRole("textbox", { name: "Hours" }).fill("1.5");
  await page.getByLabel("What you did").fill("First pass");
  await page.getByRole("button", { name: "Log time" }).click();
  await page.getByText("Time logged.").waitFor();
  assert.match(await text(page), /1 h 3\d min/);
  await assertAccessible(page, "the Time page with entries");

  // The dashboard's panels.
  await page.goto(`${t.origin}/`);
  await page.getByRole("heading", { name: "Hours this week" }).waitFor();
  await page.getByRole("heading", { name: "Projects over budget" }).waitFor();
  await assertAccessible(page, "the dashboard with hours and budgets");

  // A project's money.
  await page.goto(`${t.origin}/projects/${project.id}`);
  await page.getByRole("link", { name: "Money", exact: true }).last().click();
  await page.waitForURL((url) => url.pathname.endsWith("/money"));
  await assertAccessible(page, "a project's money");
  await page.getByText("Set the budget by hand").click();
  await page.getByLabel("Budget in dollars").fill("100");
  await page.getByLabel("Budget in hours").fill("1");
  await page.getByRole("button", { name: "Save budget" }).click();
  await page.getByText("Budget saved.").waitFor();
  assert.match(await text(page), /Losing money/);
  await page.getByLabel("Payment status").selectOption("invoiced");
  await page.getByLabel("Invoice number or link").fill("INV-0001");
  await page.getByRole("button", { name: "Save payment status" }).click();
  await page.getByText("Payment status saved.").waitFor();
  await page.getByText("Record an expense").click();
  await page.getByLabel("Expense amount in dollars").fill("12.50");
  await page.getByLabel("What it was for").fill("Hosting, first month");
  await page.getByRole("button", { name: "Record expense" }).click();
  await page.getByText("Expense recorded.").waitFor();
  await assertAccessible(page, "a project's money, filled in");

  // An invoice: draft, send, record the payment.
  await page.getByText("Draft an invoice").click();
  await page.getByLabel("Description").fill("Full amount");
  await page.getByLabel("Invoice amount in dollars").fill("100");
  await page.getByRole("button", { name: "Draft invoice" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/invoices/"));
  await assertAccessible(page, "a draft invoice");
  await page.getByRole("button", { name: "Send this invoice" }).click();
  await page.getByText("Invoice sent.").waitFor();
  await assertAccessible(page, "a sent invoice");
  await page.getByLabel("How it was paid").selectOption("cash");
  await page.getByRole("button", { name: "Record payment" }).click();
  await page.getByText("Payment recorded.").waitFor();
  assert.match(await text(page), /Status ?Paid/);
  await assertAccessible(page, "a paid invoice");

  // The overview, with the project over budget, and an export.
  await page.getByRole("link", { name: "Money", exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === "/money");
  assert.match(await text(page), /Bakery website ?Over budget/);
  await assertAccessible(page, "the money overview");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Time, every entry (CSV)" }).click()]);
  assert.match(download.suggestedFilename(), /^hq-time-\d{4}-\d{2}-\d{2}\.csv$/);
  await page.goto(`${t.origin}/`);
  assert.match(await text(page), /Projects over budget ?Bakery website/);

  assert.deepEqual(problems, []);
  await context.close();
});
