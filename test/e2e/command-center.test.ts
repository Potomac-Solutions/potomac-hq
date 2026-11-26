// Decision 0015 in a real browser: the hubs by keyboard, Get HQ ready, and
// the assistant's box (Enter sends, a card waits for Do it), each screen
// checked for accessibility, light and dark, with the content security
// policy in force. Claude is a stand-in.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import type { AiModel, ChatBlock } from "../../src/ai/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { PASSWORD, TEST_PASSWORD_COST, testApp, type TestApp } from "../support/harness.ts";

let t: TestApp;
let browser: Browser;
const queue: ChatBlock[][] = [];
const fake: AiModel = {
  async ask() {
    return { ok: false, problem: "Not used here.", inputCount: 0, outputCount: 0 };
  },
  async converse() {
    const blocks = queue.shift();
    return blocks ? { ok: true, blocks, stopReason: "end_turn", inputCount: 500, outputCount: 40 } : { ok: false, problem: "Nothing queued.", inputCount: 0, outputCount: 0 };
  },
};

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, ai: fake, builderOwner: "mikey@example.com" });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await t.stop();
});

test("hubs, Get HQ ready, and the assistant", async () => {
  const page = await (await browser.newContext()).newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  await page.getByRole("heading", { name: "Home", level: 1 }).waitFor();
  assert.match(await text(page), /Get HQ ready \d of 8 done/);
  assert.match(await text(page), /The assistant is off/);

  // A hub opens from the keyboard, and its pages are links.
  const nav = page.getByRole("navigation", { name: "Main" });
  assert.equal(await nav.getByRole("link", { name: "Newsletter" }).isVisible(), false, "Growth starts folded");
  await nav.locator("summary", { hasText: "Growth" }).focus();
  await page.keyboard.press("Enter");
  await nav.getByRole("link", { name: "Newsletter" }).click();
  await page.waitForURL((url) => url.pathname === "/newsletter");
  assert.equal(await nav.getByRole("link", { name: "Newsletter" }).getAttribute("aria-current"), "page");
  assert.equal(await nav.locator("details[open]").count(), 1, "only the hub you're in is open");

  // Turn the assistant on, then ask it for a change.
  await page.goto(t.origin + "/settings/ai");
  await page.getByLabel(/The assistant/).check();
  await page.getByRole("button", { name: "Save AI settings" }).click();
  await page.getByText("AI settings saved").waitFor();
  await nav.getByRole("link", { name: "Home", exact: true }).click();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.reload();
    await assertAccessible(page, `Home with the assistant (${colorScheme})`);
  }

  queue.push([{ type: "text", text: "I'll add it." }, { type: "tool_use", id: "toolu_1", name: "quick_add", input: { line: "Send Grover the proof tomorrow" } }]);
  const box = page.getByLabel("Tell the assistant what needs to happen");
  await box.fill("remind me to send Grover the proof tomorrow");
  await box.press("Enter");
  await page.getByText("Waiting for you").waitFor();
  assert.match(await text(page, "#chat"), /Add a to-do: “Send Grover the proof” · Due/);
  await assertAccessible(page, "a card waiting");
  await page.getByRole("button", { name: /^Do it/ }).click();
  await page.getByText("Done: Add a to-do").waitFor();
  assert.equal(t.db.prepare("select count(*) as n from task where title = 'Send Grover the proof'").get()?.["n"], 1);
  await page.getByRole("link", { name: "Open it" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/tasks/"));

  assert.deepEqual(problems, []);
});

test("the command bar, the drawer on any page, pins and the phone's tab bar", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(t.origin + "/");
  await page.getByLabel("Email").fill("mikey@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  // Watched from here: the signed-out page answers 401 by design.
  const problems = watch(page);

  // / opens the command bar; a page comes up as you type; Enter opens it.
  await page.keyboard.press("/");
  const bar = page.getByRole("dialog", { name: "Go to a page or record" });
  await bar.waitFor();
  // Nothing typed lists this person's pages, by hub (decision 0014's palette did too).
  await bar.getByRole("option", { name: /Clients\s*Clients/ }).waitFor();
  assert.ok((await bar.getByRole("option").count()) > 10, "every page in the sidebar");
  // Kept from decision 0014's palette: quick add and search what's typed, with Enter still asking the assistant when nothing matches.
  await page.getByLabel("Go to a page or record, or ask the assistant").fill("qqzzx nothing");
  await bar.getByRole("option", { name: /Search everything for “qqzzx nothing”/ }).waitFor();
  await bar.getByRole("option", { name: /Quick add “qqzzx nothing”/ }).click();
  assert.equal(await page.locator("#hq-quick-text").inputValue(), "qqzzx nothing");
  await page.locator("#hq-quick-text").fill("");
  await page.keyboard.press("Escape");
  await page.locator("main").focus();
  await page.keyboard.press("/");
  await bar.waitFor();
  await page.getByLabel("Go to a page or record, or ask the assistant").fill("booking hours");
  await bar.getByRole("option", { name: /Calendar hours/ }).waitFor();
  await assertAccessible(page, "the command bar");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.pathname === "/calls/hours");

  // Pin it; it's at the top of the sidebar on every page.
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await page.getByText("Pinned to your sidebar.").waitFor();
  await page.goto(t.origin + "/money");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Calendar hours" }).waitFor();

  // Ask, from any page: the drawer, sent with this page's address.
  await page.getByRole("link", { name: "Ask", exact: true }).click();
  await page.getByRole("heading", { name: "Assistant" }).waitFor();
  await assertAccessible(page, "the assistant's drawer");
  queue.push([{ type: "text", text: "Money is on [Money](/money)." }]);
  const box = page.getByLabel("Tell the assistant what needs to happen here");
  await box.fill("where am I?");
  await box.press("Enter");
  await page.waitForURL((url) => url.pathname === "/money" && url.searchParams.get("chat") === "open");
  await page.locator("#assistant").getByText("Money is on").waitFor();
  await page.getByRole("link", { name: "Close the assistant" }).click();
  await page.waitForURL((url) => url.pathname === "/money" && !url.searchParams.has("chat"));

  // A phone: the tab bar along the bottom.
  await page.setViewportSize({ width: 390, height: 844 });
  const tabs = page.getByRole("navigation", { name: "Quick" });
  await tabs.getByRole("link", { name: "Today" }).click();
  await page.waitForURL((url) => url.pathname === "/today");
  await assertAccessible(page, "Today on a phone");

  assert.deepEqual(problems, []);
});
