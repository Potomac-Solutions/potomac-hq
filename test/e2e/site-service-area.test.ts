// A service area in a real browser: a towing company's site with no photo
// gallery, only a map of where it goes. The owner, on his phone, adds a county
// with a tap on the map, draws an area around the lake point by point, names
// it and saves: the site's file changes at once. Every screen gets the
// accessibility check, in light and in dark.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { fakeSiteRepo } from "../support/fake-site-repo.ts";
import { PASSWORD, TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";

const repo = fakeSiteRepo({
  "src/content/site.json": JSON.stringify({ serviceArea: { areas: [{ name: "Garrett County", county: "24023", ring: [[-79.48, 39.72], [-79.07, 39.72], [-79.07, 39.48], [-79.49, 39.21]] }] } }),
});
type File = { serviceArea: { areas: { name: string; county?: string; ring: number[][] }[] } };

let t: TestApp;
let browser: Browser;
before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, sitePublisher: repo.publisher });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await t.stop();
});

/** Taps the map at a point in its own drawing units (640 by 440). */
async function tapMap(page: Page, x: number, y: number): Promise<void> {
  const box = await page.locator("svg.sa-map").boundingBox();
  assert.ok(box);
  await page.mouse.click(box.x + (x / 640) * box.width, box.y + (y / 440) * box.height);
}

test("the owner changes where he goes, on the map, and the site has it at once", async () => {
  const staff = await (await browser.newContext()).newPage();
  const staffProblems = watch(staff);
  await setUpAdmin(t, staff);
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const client = unwrap(crm.createClient(t.services.crm, mikey, { name: "Better Days Towing", sizeTier: "small" }));

  await staff.goto(`${t.origin}/clients/${client.id}`);
  await staff.getByText("Set up website editing").click();
  await staff.getByLabel("What to call it").fill("Better Days website");
  await staff.getByLabel("Repository").fill("Potomac-Solutions/example-towing");
  await staff.getByRole("button", { name: "Set up and read the site" }).click();
  await staff.getByRole("heading", { name: "Service area" }).waitFor();
  assert.equal(await staff.getByRole("heading", { name: "Nothing is waiting" }).count(), 0, "no photos to check on a site without them");
  for (const colorScheme of ["light", "dark"] as const) {
    await staff.emulateMedia({ colorScheme });
    await assertAccessible(staff, `a site with a service area (${colorScheme})`);
  }
  await staff.goto(`${t.origin}/clients/${client.id}`);
  await staff.getByText("Invite someone to the portal").click();
  await staff.getByLabel("Their name").fill("Stacy Roberts");
  await staff.getByLabel("Their email").fill("stacy@betterdays.example");
  await staff.getByRole("button", { name: "Invite" }).click();
  const link = await staff.getByLabel(/link/i).first().inputValue();

  // Stacy, on his phone.
  const stacy = await (await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: false })).newPage();
  const stacyProblems = watch(stacy);
  await stacy.goto(new URL(link, t.origin).href);
  await stacy.getByLabel(/Choose a password/).fill(PASSWORD);
  await stacy.getByRole("button", { name: "Save and sign in" }).click();
  await stacy.waitForURL((url) => url.pathname === "/portal");
  await stacy.getByText("Change where you go, on the map.").waitFor();
  await stacy.getByRole("link", { name: "Update your website" }).click();
  await stacy.getByRole("heading", { name: "Where you go" }).waitFor();
  await stacy.getByRole("button", { name: "Draw an area" }).and(stacy.locator(":enabled")).waitFor();
  await assertAccessible(stacy, "where you go");
  assert.ok(Number(await stacy.evaluate("document.documentElement.scrollWidth")) <= 390, "the page fits a phone");

  // Allegany is next door, to the east: a tap on it adds it.
  const allegany = stacy.locator("path.sa-county", { has: stacy.locator("title", { hasText: "Allegany County, MD" }) });
  const before = await allegany.getAttribute("class");
  assert.doesNotMatch(before ?? "", /picked/);
  const box = await allegany.boundingBox();
  assert.ok(box);
  await stacy.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45);
  await stacy.waitForFunction("document.querySelector('input[name=\"county-24001\"]')?.checked === true");
  assert.match((await allegany.getAttribute("class")) ?? "", /picked/);

  // Then he draws around the lake: four taps, a name, finish.
  await stacy.getByRole("button", { name: "Draw an area" }).click();
  for (const [x, y] of [[250, 200], [330, 200], [330, 260], [250, 260]] as const) await tapMap(stacy, x, y);
  assert.equal(await stacy.locator("circle.sa-dot").count(), 4);
  await stacy.getByLabel("Name this area").fill("Deep Creek Lake and around");
  await stacy.getByRole("button", { name: "Finish this area" }).click();
  await stacy.getByRole("heading", { name: "Areas drawn by hand" }).waitFor();
  assert.equal(await stacy.locator("path.sa-drawn").count(), 1);
  for (const colorScheme of ["light", "dark"] as const) {
    await stacy.emulateMedia({ colorScheme });
    await assertAccessible(stacy, `where you go, with an area drawn (${colorScheme})`);
  }

  await stacy.getByRole("button", { name: "Save where you go" }).click();
  await stacy.getByText("Saved. The map on your website updates in a minute or two.").waitFor();
  assert.equal(repo.commits.length, 1);
  const file = JSON.parse(repo.text("src/content/site.json")) as File;
  assert.deepEqual(file.serviceArea.areas.map((one) => [one.name, one.county ?? null]), [["Garrett County", "24023"], ["Allegany County", "24001"], ["Deep Creek Lake and around", null]]);
  const lake = file.serviceArea.areas[2]?.ring ?? [];
  assert.equal(lake.length, 4);
  for (const [lon = NaN, lat = NaN] of lake) assert.ok(lon > -80.5 && lon < -78 && lat > 38.8 && lat < 40.3, `a point near the lake: ${lon}, ${lat}`);
  assert.match(await text(stacy, "#service-area"), /Garrett County, Allegany County and Deep Creek Lake and around\./);

  // Potomac sees it on the dashboard.
  await staff.goto(`${t.origin}/`);
  assert.match(await text(staff), /Stacy Roberts \(Better Days Towing\) changed the service area on their website/);
  assert.deepEqual(staffProblems, []);
  assert.deepEqual(stacyProblems, []);
});
