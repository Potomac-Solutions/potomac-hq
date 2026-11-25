// The call screen in a real browser (decision 0009, slice 1): start a call
// from a client, the timer ticking, the nudge to wrap up (amber, one buzz,
// announced), the overtime, notes saving as they're typed, and ending the
// call into the call log. Every screen is checked by axe, on a phone's width.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";

let t: TestApp;
// Runs in the page: the buzzes the test's stand-in for navigator.vibrate counted.
const BUZZES = "window.buzzes";
let browser: Browser;

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await t.stop();
});

test("a timed call, from Start a call to the call log", async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  // Count the phone's buzzes, which a test browser can't feel.
  await context.addInitScript({ content: "window.buzzes = []; Object.defineProperty(navigator, 'vibrate', { value: (pattern) => (window.buzzes.push(pattern), true) });" });
  const page = await context.newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const shop = unwrap(crm.createClient(t.services.crm, mikey, { name: "Hensley Body Shop" }));
  unwrap(crm.addContact(t.services.crm, mikey, shop.id, { name: "Dale Hensley", email: "dale@example.com", phone: "304-555-0100", isPrimary: true }));
  // Open hours every day, so there are times to book from the wrap-up panel.
  const allWeek = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].flatMap((day) => [[`start-${day}-0`, "00:00"], [`end-${day}-0`, "23:00"]]));
  const hours = await page.request.post(`${t.origin}/calls/hours`, { form: { ...allWeek, "call-minutes": "30", "gap-minutes": "0", "notice-hours": "1", "days-ahead": "14" }, headers: { origin: t.origin }, maxRedirects: 0 });
  assert.equal(hours.status(), 303);

  // A follow-up due today puts them on the calls to make; call from there.
  const deal = unwrap(crm.createOpportunity(t.services.crm, mikey, shop.id, { title: "New website", leadSource: "referral" }));
  t.db.prepare("update opportunity set follow_up_on = ? where id = ?").run(Temporal.Now.plainDateISO("America/New_York").toString(), deal.id);
  await page.goto(`${t.origin}/today`);
  await page.getByRole("heading", { name: "Calls to make" }).waitFor();
  await assertAccessible(page, "Today with calls to make");
  await page.getByRole("button", { name: "Call Hensley Body Shop" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/phone/"));
  const id = new URL(page.url()).pathname.split("/")[2] ?? "";
  await page.getByRole("link", { name: "Dial 304-555-0100" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Dial 304-555-0100" }).getAttribute("href"), "tel:+13045550100");
  await assertAccessible(page, "the call screen");

  // It ticks.
  const timer = page.getByRole("timer", { name: "Time on the call" });
  await page.locator(".call-timer-time").filter({ hasText: /^0:0[1-9]$/ }).waitFor();
  assert.match(await timer.innerText(), /On the call/);
  assert.equal(await page.getByRole("region", { name: "Wrapping up" }).isVisible(), false, "the wrap-up panel waits");

  // Picked up with only 15 minutes to give: one tap.
  assert.match(await text(page), /Planned for 30 min\./);
  await page.getByRole("button", { name: "15 min" }).click();
  await page.getByText("Planned for 15 minutes.").waitFor();
  assert.equal(await page.getByRole("button", { name: "15 min" }).getAttribute("aria-pressed"), "true");

  // Two seconds before wrapping up: it turns amber, buzzes once and says so.
  t.db.prepare("update call set started_at = ? where id = ?").run(new Date(Date.now() - (10 * 60 - 2) * 1000).toISOString(), id);
  await page.reload();
  await page.getByText("Start wrapping up", { exact: true }).waitFor({ timeout: 8000 });
  assert.equal(await page.evaluate("document.documentElement.dataset.callPhase"), "wrap-up");
  await page.getByRole("region", { name: "Wrapping up" }).waitFor();
  assert.match(await page.locator("[aria-live=assertive]").innerText(), /5 minutes left\. Time to start wrapping up\./);
  assert.deepEqual(await page.evaluate(BUZZES), [300]);
  await page.getByRole("group", { name: "Book another call (30 min)" }).waitFor();
  await assertAccessible(page, "the call screen, wrapping up");
  // A reload doesn't buzz again.
  await page.reload();
  await page.getByText("Start wrapping up", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(BUZZES), []);

  // Overtime.
  t.db.prepare("update call set started_at = ? where id = ?").run(new Date(Date.now() - 16 * 60 * 1000).toISOString(), id);
  await page.reload();
  await page.getByText("Over the planned time", { exact: true }).waitFor();
  assert.match(await timer.innerText(), /^16:0\d/);
  await assertAccessible(page, "the call screen, over time");

  // The guide: a first call for a new client. Ticking and typing save themselves.
  await page.getByRole("heading", { name: "First call" }).waitFor();
  await page.getByLabel("What does the business do, and who are its customers?").check();
  await page.getByText("Answers saved.").waitFor({ timeout: 5000 });
  await page.getByRole("textbox", { name: "What they said" }).first().fill("Collision repair, local drivers.");
  const answerSaved = () => t.db.prepare("select asked, answer from call_answer where call_id = ? and position = 1").get(id) as Record<string, unknown> | undefined;
  for (let tries = 0; tries < 50 && answerSaved()?.["answer"] !== "Collision repair, local drivers."; tries++) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual([answerSaved()?.["asked"], answerSaved()?.["answer"]], [1, "Collision repair, local drivers."]);

  // Notes save as they're typed, with nothing pressed.
  await page.getByLabel("Notes").fill("Wants online booking. Quote by Friday.");
  await page.getByText("Notes saved.").waitFor({ timeout: 5000 });
  assert.equal(t.db.prepare("select note from call where id = ?").get(id)?.["note"], "Wants online booking. Quote by Friday.");

  // Book the next call while they're still on the line.
  await page.getByRole("group", { name: "Book another call (30 min)" }).getByRole("radio").first().check();
  await page.getByRole("button", { name: "Book it" }).click();
  await page.getByText(/^Booked: /).waitFor();
  assert.equal(t.db.prepare("select count(*) as n from booking where crm_client_id = ?").get(shop.id)?.["n"], 1);

  // End it, with a next step for later.
  await page.getByLabel("Next steps for you").fill("Send the quote");
  await page.getByLabel("Talked").check();
  await page.getByRole("button", { name: "End call, back to the list" }).click();
  await page.waitForURL((url) => url.pathname === "/today");
  await page.getByText("Call ended and logged. 1 to-do added.").waitFor();
  assert.match(await text(page), /1 called already today\.|All called today/);
  await page.goto(`${t.origin}/opportunities/${deal.id}`);
  assert.match(await text(page), /Call, talked, 1[67] min/);
  assert.match(await text(page), /Wants online booking\. Quote by Friday\. - What does the business do, and who are its customers\? Collision repair, local drivers\./);
  // A booked call in 10 minutes: the top bar says get ready, and the page is ready to start it.
  const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
  t.db.prepare("insert into booking (id, kind, status, starts_at, ends_at, name, email, phone, topic, crm_client_id, host_id, created_at) values (?, 'public', 'booked', ?, ?, 'Dale Hensley', 'dale@example.com', '304-555-0100', 'The quote', ?, ?, ?)").run("00000000-0000-4000-8000-00000000e001", soon(10), soon(40), shop.id, mikey, new Date().toISOString());
  await page.goto(`${t.origin}/clients`);
  await page.getByRole("link", { name: /^Call in (9|10) minutes with Dale Hensley/ }).click();
  await page.getByRole("heading", { name: "Dale Hensley", level: 1 }).waitFor();
  await assertAccessible(page, "getting ready for a booked call");
  await page.getByRole("button", { name: "Start the call" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/phone/"));
  assert.match(await text(page), /Planned for 30 min\./);

  assert.deepEqual(problems, []);
  await context.close();
});
