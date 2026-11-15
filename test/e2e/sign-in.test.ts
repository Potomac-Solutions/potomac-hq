// The sign-in workflow in a real browser, by keyboard where it matters.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
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
  app = createApp({ db, secure: false, proxies: 0, noticeSecret: "e2e-secret-e2e-secret-e2e-secret-00000" });
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

test("set up the first admin, sign out, and sign back in", async () => {
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  // Nobody has an account: the home page says so.
  await page.goto(origin + "/");
  assert.match((await page.textContent("body")) ?? "", /Nobody has an account here yet/);

  // The setup link from the server log.
  const setup = await app.setupPath();
  assert.ok(setup);
  await page.goto(origin + setup);
  await page.getByLabel("Your email").fill("mikey@example.com");
  await page.getByLabel("Your name").fill("Mikey Nichols");
  await page.getByLabel(/Choose a password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Make my account" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  assert.match((await page.textContent("body")) ?? "", /signed in as Mikey Nichols/);
  assert.match((await page.textContent("[role=status]")) ?? "", /signed in/i);

  // Sign out.
  await page.getByRole("button", { name: /sign out/i }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.getByLabel("Email").waitFor();

  // A wrong password is refused with a message.
  await page.getByLabel("Email").fill("mikey@example.com");
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.searchParams.has("problem"));
  assert.match((await page.textContent("[role=alert]")) ?? "", /don’t match/);

  // Sign back in using only the keyboard.
  await page.getByLabel("Email").focus();
  await page.keyboard.type("mikey@example.com");
  await page.keyboard.press("Tab");
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.pathname === "/" && !url.searchParams.has("problem"));
  assert.match((await page.textContent("body")) ?? "", /signed in as Mikey Nichols/);

  // The content security policy blocked nothing the pages need.
  assert.deepEqual(consoleErrors, []);

  const actions = (
    db.prepare("select action from activity_event order by occurred_at, rowid").all() as { action: string }[]
  ).map((event) => event.action);
  assert.deepEqual(actions, ["user.created", "user.signed-in", "user.signed-out", "user.signed-in"]);
  await page.close();
});
