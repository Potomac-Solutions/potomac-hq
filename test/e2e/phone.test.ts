// HQ on a phone: every staff page fits a 320px screen with real-looking data
// (long names, a long email address, tables), and a contact's phone number
// is a tap to call. Wide tables scroll inside their panel, never the page.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import * as crm from "../../src/crm/index.ts";
import { addProjectLink } from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin } from "../support/browser.ts";
import { TEST_PASSWORD_COST, testApp, unwrap, wonProject, type TestApp } from "../support/harness.ts";

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

test("every staff page fits a phone, and contacts are a tap to call", async () => {
  const page = await (await browser.newContext({ viewport: { width: 320, height: 780 } })).newPage();
  await setUpAdmin(t, page);
  const me = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const client = unwrap(crm.createClient(t.services.crm, me, { name: "Gormania Feed and Farm Supply", sizeTier: "small" }));
  unwrap(crm.addContact(t.services.crm, me, client.id, { name: "Bob Miller", email: "bob.miller.longaddress@gormaniafeed.example", phone: "304-555-0100", isPrimary: true }));
  const opportunity = unwrap(crm.createOpportunity(t.services.crm, me, client.id, { title: "A new website with online ordering", leadSource: "referral" }));
  const { project } = await wonProject(t.services, me);
  unwrap(addProjectLink(t.services.projects, me, project.id, { kind: "staging", url: "staging.a-very-long-client-name-for-testing.example.com/menu", shared: true }));
  const pages = ["/", "/today", "/todos", "/pipeline", "/clients", `/clients/${client.id}`, `/opportunities/${opportunity.id}`, "/projects", `/projects/${project.id}`, "/board", "/time", "/money", "/money/profit", "/proposals", "/calls", "/renewals", "/sites", "/reports", "/knowledge", "/search?q=bob", "/settings", "/people"];
  for (const path of pages) {
    const res = await page.goto(t.origin + path);
    assert.equal(res?.status(), 200, path);
    assert.equal(await page.evaluate("document.documentElement.scrollWidth"), 320, `${path} is wider than the phone`);
  }
  await page.goto(`${t.origin}/opportunities/${opportunity.id}`);
  assert.equal(await page.getByRole("link", { name: "304-555-0100" }).getAttribute("href"), "tel:304-555-0100", "the client's primary contact, a tap to call");
  await assertAccessible(page, "an opportunity on a phone");
  await page.goto(`${t.origin}/projects/${project.id}`);
  await assertAccessible(page, "a project with a link on a phone");
  await page.goto(`${t.origin}/clients/${client.id}`);
  assert.equal(await page.getByRole("link", { name: "304-555-0100" }).getAttribute("href"), "tel:304-555-0100");
  await assertAccessible(page, "a client on a phone");
});
