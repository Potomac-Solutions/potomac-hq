// Decision 0015 in a real browser: the hubs by keyboard, Get HQ ready, and
// the assistant's box (Enter sends, a card waits for Do it), each screen
// checked for accessibility, light and dark, with the content security
// policy in force. Claude is a stand-in.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import type { AiModel, ChatBlock } from "../../src/ai/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { TEST_PASSWORD_COST, testApp, type TestApp } from "../support/harness.ts";

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
