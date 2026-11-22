// The sign-in workflow and the shell in a real browser: by keyboard where it
// matters, with an automated accessibility check on every screen, and with
// the content security policy in force.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser, type Page } from "playwright";
import { createApp, type App } from "../../src/app.ts";
import { migrate, openDatabase, readMigrations, systemClock, type Database } from "../../src/shared/adapters.ts";

const PASSWORD = "correct horse battery";

let dir: string;
let db: Database;
let app: App;
let server: Server;
let origin: string;
let browser: Browser;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "hq-e2e-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db, readMigrations(join(import.meta.dirname, "..", "..", "migrations")), systemClock);
  app = await createApp({ db, secure: false, proxies: 0, noticeSecret: "e2e-secret-e2e-secret-e2e-secret-00000" });
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

/** WCAG 2.1 A and AA, checked by axe. Fails with each rule and the elements it flagged. */
async function assertAccessible(page: Page, screen: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const found = results.violations.map(
    (violation) => `${violation.id}: ${violation.help} [${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}]`,
  );
  assert.deepEqual(found, [], `accessibility problems on ${screen}`);
}

async function bodyText(page: Page): Promise<string> {
  return (await page.textContent("body")) ?? "";
}

test("set up the first admin, use the shell, sign out, and sign back in", async () => {
  // axe needs a page from an explicit context.
  const context = await browser.newContext();
  const page = await context.newPage();
  // A blocked script, style or image, a failed request and a script error all land here.
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("requestfailed", (request) => problems.push(`request failed: ${request.url()}`));

  // Signed out: the sign-in form, inside the shell, with the setup hint.
  await page.goto(origin + "/");
  await page.getByRole("heading", { name: "Sign in", level: 1 }).waitFor();
  assert.match(await bodyText(page), /Nobody has an account here yet/);
  assert.equal(await page.getByRole("button", { name: "Sign out" }).count(), 0);
  await assertAccessible(page, "the sign-in page");

  // The setup link from the server log. This page is written by the kit.
  const setup = await app.setupPath();
  assert.ok(setup);
  await page.goto(origin + setup);
  await assertAccessible(page, "the setup link page");
  await page.getByLabel("Your email").fill("mikey@example.com");
  await page.getByLabel("Your name").fill("Mikey Nichols");
  await page.getByLabel(/Choose a password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Make my account" }).click();
  await page.waitForURL((url) => url.pathname === "/");

  // The dashboard, in the shell. The v0.1 gate: your own sign-in is in the activity panel.
  await page.getByRole("heading", { name: "Dashboard", level: 1 }).waitFor();
  // The first admin has no two-factor sign-in yet, so the reminder is there too.
  assert.equal(await page.locator("[role=status]", { hasText: /signed in/i }).count(), 1);
  assert.equal(await page.locator("[role=status]", { hasText: "Turn on two-factor sign-in" }).count(), 1);
  const activity = page.getByRole("region", { name: "Recent activity" });
  assert.match((await activity.textContent()) ?? "", /Mikey Nichols signed in/);
  assert.match((await activity.textContent()) ?? "", /Mikey Nichols was added as a user/);
  assert.equal(await page.getByRole("link", { name: "Dashboard" }).getAttribute("aria-current"), "page");
  assert.equal(await page.title(), "Dashboard");
  await assertAccessible(page, "the dashboard");

  // Keyboard: the first Tab stop is the skip link, and it moves focus to the page's content.
  await page.goto(origin + "/");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate("document.activeElement?.textContent"), "Skip to content");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate("document.activeElement?.id"), "main");

  // An address with no page: the error page, still inside the shell.
  const missing = await page.goto(origin + "/nothing-here");
  assert.equal(missing?.status(), 404);
  await page.getByRole("heading", { name: "There is no page at this address" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Sign out" }).count(), 1);
  await assertAccessible(page, "the 404 page");
  await page.getByRole("link", { name: "Back to the dashboard" }).click();
  await page.waitForURL((url) => url.pathname === "/");

  // Settings, then the change password page, written by the kit.
  await page.getByRole("link", { name: "Settings" }).click();
  await page.waitForURL((url) => url.pathname === "/settings");
  await assertAccessible(page, "the settings page");
  await page.getByRole("link", { name: "Change your password" }).click();
  await page.waitForURL((url) => url.pathname === "/staff/password");
  await assertAccessible(page, "the change password page");
  await page.goto(origin + "/");

  // Sign out.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.getByRole("heading", { name: "Sign in", level: 1 }).waitFor();

  // A wrong password is refused with a message that is announced.
  await page.getByLabel("Email").fill("mikey@example.com");
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.searchParams.has("problem"));
  assert.match((await page.textContent("[role=alert]")) ?? "", /don’t match/);
  await assertAccessible(page, "the sign-in page with an error");

  // Sign back in using only the keyboard.
  await page.getByLabel("Email").focus();
  await page.keyboard.type("mikey@example.com");
  await page.keyboard.press("Tab");
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.pathname === "/" && !url.searchParams.has("problem"));
  await page.getByRole("heading", { name: "Dashboard", level: 1 }).waitFor();

  // Nothing was blocked by the content security policy, and nothing failed to
  // load. The 401 and 404 pages' own statuses are the expected exceptions.
  assert.deepEqual(
    problems.filter((problem) => !/the server responded with a status of 40[14]/.test(problem)),
    [],
  );

  const actions = (
    db.prepare("select action from activity_event order by rowid").all() as { action: string }[]
  ).map((event) => event.action);
  assert.deepEqual(actions, ["user.created", "user.signed-in", "user.signed-out", "user.signed-in"]);
  await context.close();
});

test("the pages work with JavaScript turned off", async (t) => {
  // Uses the account the first test set up.
  if ((db.prepare("select count(*) as n from user").get()?.["n"] as number) === 0) {
    t.skip("the first test did not create the account");
    return;
  }
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(origin + "/");
  await page.getByLabel("Email").fill("mikey@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  assert.match((await page.getByRole("region", { name: "Recent activity" }).textContent()) ?? "", /Mikey Nichols signed in/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.getByRole("heading", { name: "Sign in", level: 1 }).waitFor();
  await context.close();
});
