// Shared pieces for the browser tests: the accessibility check every screen
// gets, the first admin's setup, and a watch for script errors.
import assert from "node:assert/strict";
import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import { PASSWORD, type TestApp } from "./harness.ts";

export async function assertAccessible(page: Page, screen: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const found = results.violations.map((violation) => `${violation.id}: ${violation.help} [${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}]`);
  assert.deepEqual(found, [], `accessibility problems on ${screen}`);
}

export async function text(page: Page, selector = "main"): Promise<string> {
  return ((await page.textContent(selector)) ?? "").replace(/\s+/g, " ");
}

/** Collects console errors and page errors. Assert it is empty at the end. */
export function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  return problems;
}

/** Uses the setup link to make the first admin, and lands on the dashboard. */
export async function setUpAdmin(t: TestApp, page: Page, name = "Mikey Nichols", email = "mikey@example.com"): Promise<void> {
  const setup = await t.app.setupPath();
  assert.ok(setup);
  await page.goto(t.origin + setup);
  await page.getByLabel("Your email").fill(email);
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel(/Choose a password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Make my account" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}
