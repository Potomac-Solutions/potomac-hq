// Booking in a real browser: setting the hours, then the Calls page. Each
// screen is checked for accessibility, in light and dark.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { saveBookingSetup } from "../../src/booking/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin } from "../support/browser.ts";
import { TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";

/** The links in emails point here; the test opens them on its own origin. */
const t0 = "https://hq.example";
let t: TestApp;
let browser: Browser;
const sent: { to: string; body: string }[] = [];
before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: t0, email: { publicUrl: t0, send: async (message) => (sent.push({ to: message.to, body: message.body }), { ok: true }) } });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await t.stop();
});

test("set the hours, then see them on Calls", async () => {
  const page = await (await browser.newContext()).newPage();
  await setUpAdmin(t, page);
  await page.goto(`${t.origin}/calls/hours`);
  for (const label of ["Mondays, 9:00 AM to 9:30 AM", "Mondays, 9:30 AM to 10:00 AM"]) await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("button", { name: "Save my usual week" }).click();
  await page.getByText("Your usual week is saved.").waitFor();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved. The open times have changed.").waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(`${t.origin}/calls/hours`);
    await assertAccessible(page, `hours for calls (${colorScheme})`);
    await page.goto(`${t.origin}/calls`);
    await page.getByRole("heading", { name: "Coming up" }).waitFor();
    await assertAccessible(page, `calls (${colorScheme})`);
  }
});

test("a prospect signs up on a phone, confirms by email, and books in the portal", async () => {
  const page = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
  // Open to new people: weekdays, 9 to 12.
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const weekdays = Object.fromEntries([1, 2, 3, 4, 5].flatMap((day) => [[`start-${day}-0`, "09:00"], [`end-${day}-0`, "12:00"]]));
  unwrap(saveBookingSetup(t.services.booking, mikey, { ...weekdays, "call-minutes": "30", "gap-minutes": "15", "notice-hours": "24", "days-ahead": "21", "public-open": "1" }));
  const fits = async (what: string) => {
    const size = (await page.evaluate("({ page: document.documentElement.scrollWidth, screen: window.innerWidth })")) as { page: number; screen: number };
    assert.ok(size.page <= size.screen, `${what} is ${size.page}px wide on a ${size.screen}px phone`);
    await assertAccessible(page, `${what} on a phone`);
  };

  await page.goto(`${t.origin}/book`);
  await page.getByRole("heading", { name: "Book a call with Potomac Solutions" }).waitFor();
  await fits("the booking page");
  await page.getByRole("link", { name: "Sign up to book" }).click();
  await page.getByRole("heading", { name: "Sign up to book a call" }).waitFor();
  await fits("the sign-up page");
  await page.getByLabel("Your name").fill("Dale Pruitt");
  await page.getByLabel("Your business").fill("Pruitt Farm Stand");
  await page.getByLabel("Your email").fill("dale@example.com");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByText("Check your email at dale@example.com.").waitFor();
  await fits("the sign-up page after signing up");
  const link = /https:\/\/hq\.example(\/portal\/accept\?\S+)/.exec(sent.find((one) => one.to === "dale@example.com")?.body ?? "")?.[1];
  assert.ok(link);
  await page.goto(t.origin + link);
  await fits("choosing a password after signing up");
  await page.getByLabel("Choose a password").fill((await import("../support/harness.ts")).PASSWORD);
  await page.getByRole("button", { name: "Save and sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/portal/book");
  await page.getByText("You’re signed in. Choose a time for your call.").waitFor();
  await fits("booking in the portal after signing up");
  await page.getByRole("button", { name: /9:00 AM$/ }).first().click();
  await page.waitForURL((url) => url.pathname.startsWith("/portal"));
  assert.equal(t.db.prepare("select count(*) as n from booking where name = 'Dale Pruitt' and status = 'booked'").get()?.["n"], 1);
  await page.emulateMedia({ colorScheme: "dark" });
  await assertAccessible(page, "the portal after booking, in dark");
});

test("the inquiry form on a phone: fits, is accessible, and thanks the sender", async () => {
  const page = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
  await page.goto(`${t.origin}/contact`);
  await page.getByRole("heading", { name: "Tell us what you need" }).waitFor();
  const size = (await page.evaluate("({ page: document.documentElement.scrollWidth, screen: window.innerWidth })")) as { page: number; screen: number };
  assert.ok(size.page <= size.screen, `the inquiry form is ${size.page}px wide on a ${size.screen}px phone`);
  await assertAccessible(page, "the inquiry form on a phone");
  await page.getByLabel("Your name").fill("Rita Okafor");
  await page.getByLabel("Your email").fill("rita@example.com");
  await page.getByLabel("Your message").fill("Online orders for the diner.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("heading", { name: "Thanks" }).waitFor();
  await assertAccessible(page, "thanks after the inquiry form");
});
