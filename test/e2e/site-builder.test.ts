// The site builder in a real browser (decision 0010), with a stand-in for
// Claude: Mikey starts a build for a client, the page shows Claude working
// and then the first version in the sandboxed preview, he asks for a
// change, and looks at the model and cap. The site in the frame can't reach
// HQ. Every screen gets the accessibility check.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import * as crm from "../../src/crm/index.ts";
import type { Claude, ClaudeAnswer } from "../../src/builder/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";

let t: TestApp;
let browser: Browser;
const jobs: (() => Promise<void>)[] = [];
let next: ClaudeAnswer = { ok: false, error: "failed", inputTokens: 0, outputTokens: 0 };
const claude: Claude = { ask: async () => next };
const runJobs = async () => {
  while (jobs.length > 0) await jobs.shift()?.();
};

// The site's own script tries to read HQ's dashboard and its cookie; the sandbox stops both.
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Better Days Towing</title><link rel="stylesheet" href="site.css"></head>
<body><main><h1>Better Days Towing</h1><p id="reach">checking</p><p><a href="tel:301-555-0100">Call 301-555-0100</a></p></main>
<script>
  fetch("/", { credentials: "include" }).then((r) => r.text()).then((html) => { document.getElementById("reach").textContent = html.includes("Dashboard") ? "reached HQ" : "no HQ" }).catch(() => { let cookie = ""; try { cookie = document.cookie } catch {} document.getElementById("reach").textContent = "no HQ" + (cookie ? " but a cookie" : "") })
</script></body></html>`;

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, claude, builderOwner: "mikey@example.com", runLater: (job) => void jobs.push(job) });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await t.stop();
});

test("Mikey makes a client's site with Claude and sees it in the preview", async () => {
  const page = await (await browser.newContext()).newPage();
  const problems = watch(page);
  await setUpAdmin(t, page);
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  unwrap(crm.createClient(t.services.crm, mikey, { name: "Better Days Towing", sizeTier: "small", phone: "301-555-0100" }));

  await page.getByRole("link", { name: "Site builder" }).click();
  await page.getByRole("heading", { name: "Site builder", level: 1 }).waitFor();
  await assertAccessible(page, "the site builder with no builds");
  await page.getByLabel("Client").selectOption({ label: "Better Days Towing" });
  await page.getByLabel("Name").fill("Better Days website");
  await page.getByLabel("Brief").fill("Towing across Western Maryland, day and night.");
  next = { ok: true, input: { summary: "Made a home page.", write: [{ path: "index.html", content: PAGE }, { path: "site.css", content: "h1 { color: #0b3d91; }" }], remove: [] }, inputTokens: 4_000, outputTokens: 3_000 };
  await page.getByRole("button", { name: "Start and make the first version" }).click();
  await page.getByText("Claude is making the first version").first().waitFor();
  await assertAccessible(page, "a build while Claude works");
  assert.equal(await page.getByRole("button", { name: "Claude is working…" }).isDisabled(), true);

  // The answer comes back; the page looks again by itself.
  await runJobs();
  await page.getByRole("heading", { name: "Version 1, the newest" }).waitFor({ timeout: 15_000 });
  const frame = page.frameLocator("iframe");
  await frame.getByRole("heading", { name: "Better Days Towing" }).waitFor();
  await frame.getByText("no HQ").waitFor();
  assert.equal(await frame.getByText("but a cookie").count(), 0);
  assert.match(await text(page), /Made a home page\./);
  await assertAccessible(page, "a build with its first version");

  // A change, at phone width.
  next = { ok: true, input: { summary: "Added a rates page.", write: [{ path: "rates.html", content: "<!doctype html><html lang=\"en\"><title>Rates</title><h1>Rates</h1></html>" }], remove: [] }, inputTokens: 5_000, outputTokens: 1_000 };
  await page.getByLabel("What should change?").fill("Add a page for towing rates.");
  await page.getByRole("button", { name: "Ask Claude" }).click();
  await runJobs();
  await page.getByRole("heading", { name: "Version 2, the newest" }).waitFor({ timeout: 15_000 });
  await page.getByRole("link", { name: "Phone" }).click();
  assert.equal(await page.locator("iframe").evaluate((el) => Math.round(el.getBoundingClientRect().width)), 390);
  await assertAccessible(page, "a build with two versions at phone width");

  await page.goto(`${t.origin}/builder/settings`);
  await page.getByLabel("Monthly cap, in dollars").fill("25");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText("Saved.").waitFor();
  assert.match(await text(page), /Better Days website/);
  await assertAccessible(page, "the site builder's model and cap");
  // The only errors are the site's own reach for HQ being refused.
  assert.deepEqual(problems.filter((one) => !/blocked by CORS policy|net::ERR_FAILED/.test(one)), []);
});
