// Scheduling invites in a real browser: a client marks times on a phone in
// the portal, by tapping; Potomac sees the overlap and books it. Each screen
// is checked for accessibility.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import * as booking from "../../src/booking/index.ts";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin } from "../support/browser.ts";
import { clientSignedIn, PASSWORD, signIn, TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";

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

test("Rita taps her times on a phone; Mikey books the one free for both", async () => {
  const staff = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await setUpAdmin(t, staff);
  const me = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  unwrap(booking.saveWeeklyGrid(t.services.booking, me, Object.fromEntries([1, 2, 3, 4, 5].flatMap((d) => [540, 570, 600, 630].map((m) => [`c-${d}-${m}`, "1"])))));
  const client = unwrap(crm.createClient(t.services.crm, me, { name: "Elk Diner", sizeTier: "small" }));
  const admin = await signIn(t, "helper@example.com", "Helper", ["admin"]);
  await admin.get("/");
  await clientSignedIn(t, admin, client.id, "Rita Okafor", "rita@example.com");
  const ritaId = t.db.prepare("select id from client_user where email = 'rita@example.com'").get()?.["id"] as Id;
  const today = Temporal.Now.plainDateISO("America/New_York");
  const monday = today.add({ days: 8 - today.dayOfWeek });
  const invite = unwrap(booking.createInvite(t.services.invites, me, ritaId, { title: "Kickoff call", minutes: "30", firstDay: monday.toString(), lastDay: monday.add({ days: 2 }).toString() }));

  // Rita, on her phone, with her portal cookie.
  const phone = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
  const page = await phone.newPage();
  await page.goto(`${t.origin}/portal/sign-in`);
  await page.getByLabel("Email").fill("rita@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/portal");
  await assertAccessible(page, "the portal home with an invite on a phone");
  await page.goto(`${t.origin}/portal/invites/${invite.id}`);
  await page.getByRole("heading", { name: "Pick times: Kickoff call" }).waitFor();
  assert.equal(await page.evaluate("document.documentElement.scrollWidth"), 360);
  await assertAccessible(page, "picking times in the portal on a phone");
  const day = monday.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const cell = page.getByLabel(`${day}, 10:00 AM to 10:30 AM`, { exact: true });
  await cell.scrollIntoViewIfNeeded();
  await cell.tap();
  await page.getByRole("button", { name: "Save my times" }).click();
  await page.getByText("Thank you. Potomac Solutions will confirm a time").waitFor();

  await staff.goto(`${t.origin}/calls/invites/${invite.id}`);
  await staff.getByRole("heading", { name: "Free for both: pick one to book it" }).waitFor();
  await assertAccessible(staff, "an invite with times in");
  await staff.getByRole("button", { name: /10:00 AM$/ }).click();
  await staff.getByText("Booked. You both have it.").waitFor();
  assert.equal(t.db.prepare("select count(*) as n from booking where status = 'booked'").get()?.["n"], 1);
  await staff.emulateMedia({ colorScheme: "dark" });
  await assertAccessible(staff, "a booked invite, in dark");
});
