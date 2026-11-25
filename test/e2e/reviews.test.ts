// Reviews and case studies in a real browser (decision 0013, slice 7): a
// client writes a review from the emailed link on a phone; Potomac publishes
// it and writes a case study. Each screen is checked for accessibility.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";

let t: TestApp;
let browser: Browser;
const sent: { body: string }[] = [];
before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: "https://hq.example", email: { publicUrl: "https://hq.example", send: async (message) => (sent.push(message), { ok: true }) } });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await t.stop();
});

test("ask, write, publish, and write a case study", async () => {
  const staff = await (await browser.newContext()).newPage();
  const problems = watch(staff);
  await setUpAdmin(t, staff);
  const mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const moats = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Moats Hardware" })).id;
  unwrap(crm.addContact(t.services.crm, mikeyId, moats, { name: "Rita Moats", email: "rita@example.com", isPrimary: true }));
  await staff.goto(`${t.origin}/clients/${moats}`);
  await staff.getByRole("link", { name: "Open reviews and case study" }).click();
  await assertAccessible(staff, "a client's reviews and case study, empty");
  await staff.getByRole("button", { name: "Email the link" }).click();
  await staff.getByText("Asked.").waitFor();
  const link = /https:\/\/hq\.example(\/review\?t=[A-Za-z0-9_-]{43})/.exec(sent.at(-1)?.body ?? "")?.[1] ?? "";

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const phoneProblems = watch(phone);
  await phone.goto(`${t.origin}${link}`);
  for (const colorScheme of ["light", "dark"] as const) {
    await phone.emulateMedia({ colorScheme });
    await phone.reload();
    await assertAccessible(phone, `writing a review (${colorScheme})`);
  }
  await phone.getByLabel("4 stars").check();
  await phone.getByLabel("In a few words").fill("Quick, friendly and the site brings in calls.");
  await phone.getByLabel(/Your name, as you’d like it shown/).fill("Rita M.");
  await phone.getByRole("button", { name: "Send my review" }).click();
  await phone.getByRole("heading", { name: "Thank you" }).waitFor();
  await assertAccessible(phone, "after writing a review");
  assert.deepEqual(phoneProblems, []);

  await staff.getByRole("link", { name: "Reviews" }).first().click();
  await staff.getByRole("heading", { name: "1 waiting" }).waitFor();
  await assertAccessible(staff, "reviews, one waiting");
  await staff.getByRole("button", { name: /^Publish/ }).click();
  await staff.getByText("Published.").waitFor();
  await staff.goto(`${t.origin}/clients/${moats}/showcase`);
  await staff.getByLabel(/^Headline/).fill("A hardware store found online");
  await staff.getByRole("checkbox", { name: /Published/ }).check();
  await staff.getByRole("button", { name: "Save case study" }).click();
  await staff.getByText("Saved and published.").waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await staff.emulateMedia({ colorScheme });
    await staff.reload();
    await assertAccessible(staff, `a client's case study (${colorScheme})`);
  }
  await staff.goto(`${t.origin}/reviews`);
  for (const colorScheme of ["light", "dark"] as const) {
    await staff.emulateMedia({ colorScheme });
    await staff.reload();
    await assertAccessible(staff, `reviews (${colorScheme})`);
  }
  assert.match(await text(staff), /A hardware store found online/);
  assert.deepEqual(problems, []);
});
