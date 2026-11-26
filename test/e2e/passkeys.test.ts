// Passkeys in a real browser, with Chromium's virtual authenticator: turning
// two-factor sign-in on with a passkey from Settings, then signing in again
// with the password and the passkey. Each screen is checked for
// accessibility. Passkeys are bound to a host name, never a bare IP address,
// so the browser opens HQ at "localhost".
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { assertAccessible, setUpAdmin, watch } from "../support/browser.ts";
import { PASSWORD, TEST_PASSWORD_COST, testApp, type TestApp } from "../support/harness.ts";

let t: TestApp;
let local: TestApp;
let browser: Browser;
before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST });
  local = { ...t, origin: t.origin.replace("127.0.0.1", "localhost") };
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await t.stop();
});

test("turn it on with a passkey in Settings, then sign in with the password and the passkey", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = watch(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

  await setUpAdmin(local, page);
  await page.goto(`${local.origin}/settings`);
  await page.getByRole("heading", { name: "With a passkey" }).waitFor();
  await assertAccessible(page, "Settings, choosing how to turn on two-factor sign-in");
  await page.getByLabel("Name for the passkey").fill("Test laptop");
  await page.getByRole("button", { name: "Turn on with a passkey" }).click();
  await page.getByRole("heading", { name: "Your recovery codes" }).waitFor();
  assert.equal(await page.locator(".codes code").count(), 10);
  await page.getByRole("link", { name: "I’ve saved them" }).click();
  await page.getByText("HQ asks for your passkey.").waitFor();
  await page.getByText("Test laptop").waitFor();
  await assertAccessible(page, "Settings, with a passkey");
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  assert.equal(credentials.length, 1);
  assert.equal(credentials[0]?.rpId, "localhost");

  // Sign out and in again: the password, then the passkey.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto(`${local.origin}/`);
  await page.getByLabel("Email").fill("mikey@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Confirm it’s you" }).waitFor();
  await assertAccessible(page, "the second step at sign-in, with a passkey");
  await page.getByRole("button", { name: "Continue with a passkey" }).click();
  await page.getByRole("heading", { name: "Home", level: 1 }).waitFor();

  // Signed in, the passkey also proves it is you: for turning two-factor sign-in off.
  await page.goto(`${local.origin}/settings`);
  await page.getByText("Last used").waitFor();
  await page.getByRole("button", { name: "Or turn it off with a passkey" }).click();
  await page.getByText("Two-factor sign-in is off. You sign in with your password alone.").waitFor();
  // The sign-in pages answer 401 on purpose; nothing else may go wrong.
  assert.deepEqual(errors.filter((line) => !line.includes("401")), []);
});
