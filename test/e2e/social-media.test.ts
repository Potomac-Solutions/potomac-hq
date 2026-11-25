// Social media in a real browser (decision 0011): set a plan, write a
// post, send the month, the client approves it in their portal, and the
// post is marked up. Each screen is checked for accessibility, light and
// dark.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { PASSWORD, TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";

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

test("a month of posts: planned, written, sent, approved in the portal, put up", async () => {
  const staff = await (await browser.newContext()).newPage();
  const staffProblems = watch(staff);
  await setUpAdmin(t, staff);
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const client = unwrap(crm.createClient(t.services.crm, mikey, { name: "Bayard Farm Stand", sizeTier: "small" }));
  const today = Temporal.Now.plainDateISO("America/New_York").toString();

  // The plan, from the client's page.
  await staff.goto(`${t.origin}/clients/${client.id}`);
  await staff.getByRole("link", { name: "Set up a plan" }).click();
  await staff.waitForURL((url) => url.pathname === `/clients/${client.id}/social`);
  await assertAccessible(staff, "a client's social media with no plan");
  await staff.getByLabel("Facebook page").fill("facebook.com/bayardfarm");
  await staff.getByLabel("About the business").fill("Friendly. Never mention prices.");
  await staff.getByRole("button", { name: "Save the plan" }).click();
  await staff.getByText("Plan saved.").waitFor();

  // A post, sent to the client.
  await staff.getByLabel("Goes up on").first().fill(today);
  await staff.locator("#write").getByLabel("Instagram").uncheck();
  await staff.locator("#write").getByLabel("Words").first().fill("Sweet corn is in.");
  await staff.getByRole("button", { name: "Add the draft" }).click();
  await staff.getByText("Post added as a draft.").waitFor();
  await assertAccessible(staff, "a client's month with a draft");
  await staff.getByRole("button", { name: "Send the draft to the client" }).click();
  await staff.getByText(/^Sent 1 to the client/).waitFor();

  // The client's portal.
  await staff.goto(`${t.origin}/clients/${client.id}`);
  await staff.getByText("Invite someone to the portal").click();
  await staff.getByLabel("Their name").fill("Pat Farmer");
  await staff.getByLabel("Their email").fill("pat@farm.example");
  await staff.getByRole("button", { name: "Invite" }).click();
  const link = await staff.getByLabel(/link/i).first().inputValue();
  const pat = await (await browser.newContext()).newPage();
  const patProblems = watch(pat);
  await pat.goto(new URL(link, t.origin).href);
  await pat.getByLabel(/Choose a password/).fill(PASSWORD);
  await pat.getByRole("button", { name: "Save and sign in" }).click();
  await pat.waitForURL((url) => url.pathname === "/portal");
  assert.match(await text(pat), /Approve your posts for/);
  await pat.getByRole("link", { name: /Look them over/ }).click();
  await pat.waitForURL((url) => url.pathname === "/portal/social");
  for (const colorScheme of ["light", "dark"] as const) {
    await pat.emulateMedia({ colorScheme });
    await assertAccessible(pat, `the client's social media waiting on them (${colorScheme})`);
  }
  await pat.getByRole("button", { name: "Approve it" }).click();
  await pat.getByText("Thank you. We’ll put them up on their days.").waitFor();
  await assertAccessible(pat, "the client's social media, approved");

  // Today, and putting it up.
  await staff.goto(`${t.origin}/today`);
  await staff.getByText("Put up a post on Facebook").first().waitFor();
  await staff.getByRole("link", { name: /Put it up/ }).first().click();
  await staff.waitForURL((url) => url.pathname === `/clients/${client.id}/social`);
  for (const colorScheme of ["light", "dark"] as const) {
    await staff.emulateMedia({ colorScheme });
    await assertAccessible(staff, `a client's month with an approved post (${colorScheme})`);
  }
  await staff.getByText(/^It’s up/).click();
  await staff.getByLabel("Link on Facebook").fill("facebook.com/bayardfarm/posts/1");
  await staff.getByRole("button", { name: "Mark it up" }).click();
  await staff.getByText("Marked up.").waitFor();
  await staff.goto(`${t.origin}/social`);
  await staff.getByRole("heading", { name: /\d{4}$/ }).waitFor();
  await assertAccessible(staff, "social media across clients");

  assert.deepEqual(staffProblems, []);
  assert.deepEqual(patProblems, []);
});
