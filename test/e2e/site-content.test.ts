// Website content in a real browser: Potomac sets a client's site up, the
// client adds a photo from their phone, which the page shrinks before
// sending, posts a notice and sends it in; Potomac checks and publishes.
// Every screen gets the accessibility check, in light and in dark.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { fakeSiteRepo } from "../support/fake-site-repo.ts";
import { PASSWORD, TEST_PASSWORD_COST, testApp, unwrap, type TestApp } from "../support/harness.ts";
import { jpegSize, png } from "../support/png.ts";

const small = png(40, 30);
const repo = fakeSiteRepo({
  "src/content/site.json": JSON.stringify({
    notice: "",
    gallery: [
      { src: "/gallery/booth.png", alt: "A clean paint booth", title: "Paint Booth", caption: "Where refinishing happens." },
      { src: "/gallery/parts.png", alt: "Shelves of parts", title: "Parts Bay" },
    ],
    testimonials: [{ quote: "They made it easy.", by: "Evelyn S. · via Yelp" }],
  }),
  "public/gallery/booth.png": small,
  "public/gallery/parts.png": small,
});

let t: TestApp;
let browser: Browser;
/** Mikey's browser, signed in by the first test and used again by the next. */
let staffPage: Page;
let dir = "";
before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, sitePublisher: repo.publisher });
  browser = await chromium.launch();
  dir = mkdtempSync(join(tmpdir(), "hq-photo-"));
  // A phone's photo: 4,000 by 3,000 pixels.
  writeFileSync(join(dir, "IMG_2041.png"), png(4000, 3000));
});
after(async () => {
  await browser?.close();
  await t.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("a client changes their own site, and Potomac publishes it", async () => {
  const staff = await (await browser.newContext()).newPage();
  staffPage = staff;
  const staffProblems = watch(staff);
  await setUpAdmin(t, staff);
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const client = unwrap(crm.createClient(t.services.crm, mikey, { name: "Nu Finish Collision Center", sizeTier: "small" }));

  // Potomac sets the site up on the client's page, and invites Dana.
  await staff.goto(`${t.origin}/clients/${client.id}`);
  await staff.getByText("Set up website editing").click();
  await staff.getByLabel("What to call it").fill("Nu Finish website");
  await staff.getByLabel("Repository").fill("Potomac-Solutions/example-site");
  await assertAccessible(staff, "a client's page, setting up website editing");
  await staff.getByRole("button", { name: "Set up and read the site" }).click();
  await staff.getByText("Set up. HQ read the site’s photos").waitFor();
  await staff.getByRole("heading", { name: "Nothing is waiting" }).waitFor();
  await assertAccessible(staff, "a site with nothing waiting");
  await staff.goto(`${t.origin}/clients/${client.id}`);
  await staff.getByText("Invite someone to the portal").click();
  await staff.getByLabel("Their name").fill("Dana Groves");
  await staff.getByLabel("Their email").fill("dana@nufinish.example");
  await staff.getByRole("button", { name: "Invite" }).click();
  const link = await staff.getByLabel(/link/i).first().inputValue();

  // Dana, on her phone.
  const dana = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const danaProblems = watch(dana);
  await dana.goto(new URL(link, t.origin).href);
  await dana.getByLabel(/Choose a password/).fill(PASSWORD);
  await dana.getByRole("button", { name: "Save and sign in" }).click();
  await dana.waitForURL((url) => url.pathname === "/portal");
  await dana.getByRole("heading", { name: "Your website" }).waitFor();
  await assertAccessible(dana, "the portal's home with a website");
  await dana.getByRole("link", { name: "Update your website" }).click();
  await dana.getByRole("heading", { name: "This is what’s on your website now" }).waitFor();
  await assertAccessible(dana, "your website, as it is");
  assert.ok(Number(await dana.evaluate("document.documentElement.scrollWidth")) <= 390, "the page fits a phone");
  const thumb = dana.getByRole("img", { name: "A clean paint booth" });
  assert.ok(await thumb.evaluate((img) => (img as unknown as { complete: boolean; naturalWidth: number }).naturalWidth > 0), "the site's own photos show");

  // She adds a photo straight off her phone. The page shrinks it before it is sent.
  await dana.getByLabel("Choose a photo, or take one").setInputFiles(join(dir, "IMG_2041.png"));
  await dana.locator("#add-photo").getByLabel("Title").fill("Red truck");
  await dana.locator("#add-photo").getByLabel("What the photo shows").fill("A red pickup with its front fender repaired");
  await dana.locator("#add-photo").getByLabel("Caption").fill("Back on the road.");
  await dana.getByRole("button", { name: "Add photo" }).click();
  await dana.getByText("Photo added. It isn’t on your website until you send your changes.").waitFor();
  const stored = t.db.prepare("select path, content_type, body from content_photo where in_repo = 0").get() as { path: string; content_type: string; body: Uint8Array };
  assert.equal(stored.content_type, "image/jpeg");
  assert.deepEqual(jpegSize(new Uint8Array(stored.body)), { width: 1600, height: 1200 }, "shrunk to 1,600 on its long side");
  assert.ok(stored.body.length < 600 * 1024, `small enough for a web page: ${stored.body.length} bytes`);
  assert.ok(await dana.getByRole("img", { name: "A red pickup with its front fender repaired" }).evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth === 1600));

  // She makes it the first photo, posts a notice, and sends it all in.
  await dana.getByRole("button", { name: /^Make first\s*: Red truck$/ }).click();
  await dana.getByText("Moved.").waitFor();
  await dana.getByLabel("What the notice says").fill("Closed Thursday and Friday for Thanksgiving.");
  await dana.getByRole("button", { name: "Save notice" }).click();
  await dana.getByRole("heading", { name: "Your changes aren’t on your website yet" }).waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await dana.emulateMedia({ colorScheme });
    await assertAccessible(dana, `your website, with changes (${colorScheme})`);
  }
  assert.ok(Number(await dana.evaluate("document.documentElement.scrollWidth")) <= 390, "still fits a phone");
  await dana.getByRole("button", { name: "Send to Potomac Solutions" }).click();
  await dana.getByRole("heading", { name: "Sent to Potomac Solutions" }).waitFor();
  await assertAccessible(dana, "your website, sent");
  assert.equal(repo.commits.length, 0, "nothing is on the site yet");

  // Potomac sees it waiting, checks it, and publishes.
  await staff.goto(`${t.origin}/websites`);
  await staff.getByRole("heading", { name: "1 site has changes to check" }).waitFor();
  for (const colorScheme of ["light", "dark"] as const) {
    await staff.emulateMedia({ colorScheme });
    await assertAccessible(staff, `site content (${colorScheme})`);
  }
  await staff.getByRole("link", { name: "Nu Finish website" }).click();
  await staff.getByRole("heading", { name: "Changes to check" }).waitFor();
  const waiting = await text(staff, "#waiting");
  for (const part of [/Sent by Dana Groves, /, /New photo: Red truck/, /A different photo comes first/, /Notice: “Closed Thursday and Friday for Thanksgiving\.”/]) assert.match(waiting, part);
  for (const colorScheme of ["light", "dark"] as const) {
    await staff.emulateMedia({ colorScheme });
    await assertAccessible(staff, `a site with changes to check (${colorScheme})`);
  }
  await staff.getByRole("button", { name: "Publish to the site" }).click();
  await staff.getByText("Published. The site rebuilds with the changes in a minute or two.").waitFor();
  assert.equal(repo.commits.length, 1);
  assert.deepEqual(repo.commits[0]?.wrote, ["src/content/site.json", stored.path]);
  const file = JSON.parse(repo.text("src/content/site.json")) as { notice: string; gallery: { title: string }[] };
  assert.equal(file.notice, "Closed Thursday and Friday for Thanksgiving.");
  assert.deepEqual(file.gallery.map((photo) => photo.title), ["Red truck", "Paint Booth", "Parts Bay"]);
  assert.deepEqual(jpegSize(repo.bytes(stored.path) ?? new Uint8Array()), { width: 1600, height: 1200 });

  await dana.goto(`${t.origin}/portal/website`);
  await dana.getByRole("heading", { name: "This is what’s on your website now" }).waitFor();
  assert.deepEqual(staffProblems, []);
  assert.deepEqual(danaProblems, []);
});

test("the client sets their site to coming soon with an opening time, and gets a preview link", async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const dana = await context.newPage();
  const problems = watch(dana);
  await dana.goto(`${t.origin}/portal/sign-in`);
  await dana.getByLabel("Email").fill("dana@nufinish.example");
  await dana.getByLabel("Password").fill(PASSWORD);
  await dana.getByRole("button", { name: "Sign in" }).click();
  await dana.goto(`${t.origin}/portal/website`);
  await dana.getByRole("heading", { name: "Is the website open?" }).waitFor();
  await dana.getByLabel("A “Coming soon” page, for before it opens").check();
  await dana.getByLabel("Open it by itself on").fill("2099-01-01");
  await dana.getByLabel("At what time").fill("00:00");
  await dana.getByLabel("A line of your own on that page").fill("Call us in the meantime.");
  await dana.getByRole("button", { name: "Save and update the website" }).click();
  await dana.getByText("Saved. Your website updates in a minute or two.").waitFor();
  assert.match(await text(dana, "#status"), /Coming soon Visitors see “Coming soon”\. It opens by itself on Thursday, January 1, 2099 at 12:00 AM\./);
  const launch = (JSON.parse(repo.text("src/content/site.json")) as { launch: Record<string, string> }).launch;
  assert.equal(launch["mode"], "coming-soon");
  assert.equal(launch["opensAt"], "2099-01-01T05:00:00Z");
  assert.match(launch["previewKeyHash"] ?? "", /^[0-9a-f]{64}$/);
  assert.ok(Number(await dana.evaluate("document.documentElement.scrollWidth")) <= 390, "the status panel fits a phone");
  for (const colorScheme of ["light", "dark"] as const) {
    await dana.emulateMedia({ colorScheme });
    await assertAccessible(dana, `your website, coming soon (${colorScheme})`);
  }

  // Potomac gives the site its address, and both sides have the preview link.
  const staff = staffPage;
  await staff.emulateMedia({ colorScheme: "light" });
  await staff.goto(`${t.origin}/websites`);
  await staff.getByRole("link", { name: "Nu Finish website" }).click();
  await staff.getByLabel("The site’s own address").fill("nufinishcollision.com");
  await staff.getByRole("button", { name: "Save address" }).click();
  await staff.getByText("Saved.").waitFor();
  const key = t.db.prepare("select preview_key from content_site").get()?.["preview_key"] as string;
  const link = `https://nufinishcollision.com/?preview=${key}`;
  assert.equal(await staff.getByRole("link", { name: /Preview the website/ }).getAttribute("href"), link);
  for (const colorScheme of ["light", "dark"] as const) {
    await staff.emulateMedia({ colorScheme });
    await assertAccessible(staff, `a site that is coming soon (${colorScheme})`);
  }
  await dana.reload();
  assert.equal(await dana.getByRole("link", { name: /Preview the website/ }).getAttribute("href"), link);
  await assertAccessible(dana, "your website, with a preview link");
  assert.deepEqual(problems, []);
});

test("with scripts off, a small photo is still added as it is", async () => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${t.origin}/portal/sign-in`);
  await page.getByLabel("Email").fill("dana@nufinish.example");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.goto(`${t.origin}/portal/website`);
  writeFileSync(join(dir, "door.png"), png(800, 600));
  await page.getByLabel("Choose a photo, or take one").setInputFiles(join(dir, "door.png"));
  await page.locator("#add-photo").getByLabel("Title").fill("Door");
  await page.locator("#add-photo").getByLabel("What the photo shows").fill("A repaired driver’s door");
  await page.getByRole("button", { name: "Add photo" }).click();
  await page.getByText("Photo added.").waitFor();
  assert.deepEqual(t.db.prepare("select content_type from content_photo where in_repo = 0").all().map((row) => row["content_type"]), ["image/png"]);
});
