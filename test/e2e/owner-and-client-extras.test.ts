// The owner-and-client extras (2026-11-26) in a real browser: the client's
// new portal panels on a phone (texts, autopay, about your business, asks),
// turning texts on there, and the new staff screens, each checked for
// accessibility.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import type { SavedPay } from "../../src/autopay/index.ts";
import * as crm from "../../src/crm/index.ts";
import * as finance from "../../src/finance/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, watch } from "../support/browser.ts";
import { PASSWORD, TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";

const texted: string[] = [];
const platform: SavedPay = {
  platform: "paypal",
  begin: async () => ({ ok: true, setup: "S", url: "https://paypal.invalid/approve" }),
  keep: async () => ({ ok: true, token: "T", label: "PayPal (rita@example.com)" }),
  charge: async () => ({ outcome: "paid", reference: "C" }),
  forget: async () => true,
};
let t: TestApp;
let browser: Browser;
let staff: Page;
let mikey: Id;
let moats: Id;
before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, texts: async (to) => (texted.push(to), { ok: true }), savedPay: platform, publicUrl: "https://hq.example" });
  browser = await chromium.launch();
  staff = await (await browser.newContext()).newPage();
  await setUpAdmin(t, staff);
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  moats = unwrap(crm.createClient(t.services.crm, mikey, { name: "Moats Hardware" })).id;
});
after(async () => {
  await browser?.close();
  await t.stop();
});

test("on a phone, the client sees the new panels and turns on text reminders", async () => {
  const invited = await staff.request.post(`${t.origin}/clients/${moats}/portal-users`, { form: { name: "Rita Moats", email: "rita@example.com" }, headers: { origin: t.origin } });
  const token = /\/portal\/accept\?token=([A-Za-z0-9_-]{43})/.exec(await invited.text())?.[1] ?? "";
  const today = Temporal.Now.plainDateISO("America/New_York").toString();
  await staff.request.post(`${t.origin}/clients/${moats}/recurring`, { form: { description: "Hosting and upkeep", amount: "49", every: "month", firstOn: today, autoSend: "1", dueDays: "15" }, headers: { origin: t.origin } });

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const problems = watch(phone);
  await phone.goto(`${t.origin}/portal/accept?token=${token}`);
  await phone.getByLabel(/Choose a password/).fill(PASSWORD);
  await phone.getByRole("button", { name: "Save and sign in" }).click();
  await phone.waitForURL((url) => url.pathname === "/portal");
  for (const heading of ["Pay my plan automatically", "Text me reminders", "About your business"]) await phone.getByRole("heading", { name: heading }).waitFor();
  await assertAccessible(phone, "the portal with the new panels");

  await phone.getByLabel("Your mobile number").fill("304-555-0142");
  await phone.getByLabel(/OK for Potomac Solutions to text me/).check();
  await phone.getByRole("button", { name: "Turn on texts" }).click();
  await phone.getByText(/We’ll text \(304\) 555-0142 reminders/).first().waitFor();
  await phone.getByRole("button", { name: "Stop texts" }).waitFor();

  await phone.goto(`${t.origin}/portal/intake`);
  await assertAccessible(phone, "the intake form");
  await phone.goto(`${t.origin}/portal/requests`);
  await assertAccessible(phone, "the request box");
  assert.deepEqual(problems, []);
});

test("staff screens: client page, money, profit by client, and a paid invoice's refund", async () => {
  const problems = watch(staff);
  await staff.goto(`${t.origin}/clients/${moats}`);
  await staff.getByText("Leaving us, or hosting their own site?").click();
  await staff.getByRole("link", { name: "Download the handoff pack" }).waitFor();
  await assertAccessible(staff, "the client page");

  await staff.goto(`${t.origin}/money`);
  await assertAccessible(staff, "the money page with late fees and the tax pack");
  await staff.goto(`${t.origin}/money/clients`);
  await assertAccessible(staff, "profit by client");

  const project = unwrap(crm.createClient(t.services.crm, mikey, { name: "Elk Diner" })).id;
  const invoice = unwrap(finance.createClientInvoice(t.services.finance, mikey, project, { kind: "other", description: "Menu page", amount: "120" }));
  unwrap(finance.sendInvoiceNow(t.services.finance, mikey, invoice.id));
  unwrap(finance.recordPayment(t.services.finance, mikey, invoice.id, { amount: "120", method: "check", on: Temporal.Now.plainDateISO("America/New_York").toString(), reference: "1042" }));
  await staff.goto(`${t.origin}/invoices/${invoice.id}`);
  await staff.getByText(/^Refund the \$120\.00 check payment/).first().click();
  await assertAccessible(staff, "a paid invoice with the refund open");
  assert.deepEqual(problems, []);
});
