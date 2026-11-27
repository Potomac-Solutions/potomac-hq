// Before and after in a real browser: a client on her phone adds a pair
// from two phone photos, which the page shrinks before sending; Potomac
// sees it on the site's page. Every screen gets the accessibility check, in
// light and in dark.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, watch } from "../support/browser.ts";
import { fakeSiteRepo } from "../support/fake-site-repo.ts";
import { PASSWORD, TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";
import { jpegSize, png } from "../support/png.ts";

const small = png(40, 30);
const repo = fakeSiteRepo({
  "src/content/site.json": JSON.stringify({
    notice: "",
    gallery: [{ src: "/gallery/booth.png", alt: "A clean paint booth", title: "Paint Booth" }],
    beforeAfter: [{ title: "Ford F-250", caption: "Front bumper", before: { src: "/gallery/f250-before.png", alt: "A torn bumper" }, after: { src: "/gallery/f250-after.png", alt: "A straight bumper" } }],
  }),
  "public/gallery/booth.png": small,
  "public/gallery/f250-before.png": small,
  "public/gallery/f250-after.png": small,
});

let t: TestApp;
let browser: Browser;
let dir = "";
before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, sitePublisher: repo.publisher });
  browser = await chromium.launch();
  dir = mkdtempSync(join(tmpdir(), "hq-pair-"));
  writeFileSync(join(dir, "IMG_3001.png"), png(4000, 3000));
  writeFileSync(join(dir, "IMG_3002.png"), png(3000, 4000));
});
after(async () => {
  await browser?.close();
  await t.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("a client adds a before and after from her phone, both photos shrunk; Potomac sees it waiting", async () => {
  const staff = await (await browser.newContext()).newPage();
  const staffProblems = watch(staff);
  await setUpAdmin(t, staff);
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const client = unwrap(crm.createClient(t.services.crm, mikey, { name: "Nu Finish Collision Center", sizeTier: "small" }));
  await staff.goto(`${t.origin}/clients/${client.id}`);
  await staff.getByText("Set up website editing").click();
  await staff.getByLabel("What to call it").fill("Nu Finish website");
  await staff.getByLabel("Repository").fill("Potomac-Solutions/example-site");
  await staff.getByRole("button", { name: "Set up and read the site" }).click();
  await staff.getByText("Set up. HQ read the site’s photos").waitFor();
  await staff.goto(`${t.origin}/clients/${client.id}`);
  await staff.getByText("Invite someone who isn’t a contact").click();
  await staff.getByLabel("Their name").fill("Dana Groves");
  await staff.getByLabel("Their email").fill("dana@nufinish.example");
  await staff.getByRole("button", { name: "Invite to the portal", exact: true }).click();
  const link = await staff.getByLabel(/link/i).first().inputValue();

  const dana = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const danaProblems = watch(dana);
  await dana.goto(new URL(link, t.origin).href);
  await dana.getByLabel(/Choose a password/).fill(PASSWORD);
  await dana.getByRole("button", { name: "Save and sign in" }).click();
  await dana.waitForURL((url) => url.pathname === "/portal");
  await dana.goto(`${t.origin}/portal/website`);
  await dana.getByRole("heading", { name: "Before and after", exact: true }).waitFor();
  assert.ok(await dana.getByRole("img", { name: "A torn bumper" }).evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth > 0), "the site's own pair shows");

  const form = dana.locator("#add-pair");
  await form.getByLabel("Before photo", { exact: true }).setInputFiles(join(dir, "IMG_3001.png"));
  await form.getByLabel("After photo", { exact: true }).setInputFiles(join(dir, "IMG_3002.png"));
  await form.getByLabel("Title", { exact: true }).fill("Subaru WRX");
  await form.getByLabel("What was done").fill("Front bumper and fender");
  await form.getByLabel("What the before photo shows").fill("A black Subaru with a scraped bumper");
  await form.getByLabel("What the after photo shows").fill("The same Subaru with a clean bumper");
  await dana.getByRole("button", { name: "Add before and after" }).click();
  await dana.getByText("Before and after added. It isn’t on your website until you send your changes.").waitFor();
  const stored = t.db.prepare("select content_type, body from content_photo where in_repo = 0 order by created_at, id").all() as { content_type: string; body: Uint8Array }[];
  assert.equal(stored.length, 2);
  const sizes = stored.map((one) => jpegSize(new Uint8Array(one.body)));
  assert.deepEqual(sizes.map((size) => Math.max(size?.width ?? 0, size?.height ?? 0)), [1600, 1600], "both shrunk to 1,600 on their long side");
  assert.ok(stored.every((one) => one.content_type === "image/jpeg"));

  for (const colorScheme of ["light", "dark"] as const) {
    await dana.emulateMedia({ colorScheme });
    await assertAccessible(dana, `your website, with a new before and after (${colorScheme})`);
  }
  assert.ok(Number(await dana.evaluate("document.documentElement.scrollWidth")) <= 390, "fits a phone");

  const site = t.db.prepare("select id from content_site").get()?.["id"] as string;
  await staff.goto(`${t.origin}/websites/${site}#before-after`);
  await staff.getByText("New before and after: Subaru WRX").waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await staff.emulateMedia({ colorScheme });
    await assertAccessible(staff, `a site with a new before and after (${colorScheme})`);
  }
  assert.deepEqual(danaProblems, []);
  assert.deepEqual(staffProblems, []);
});
