// The website's settings over real HTTP: admins open and close it, put an
// announcement on top and make a preview link; nobody else can; and the
// website itself reads them with its token.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { issueSiteToken } from "../../src/public-site/index.ts";
import { actions, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let manager: Client;
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const ask = (token?: string) => fetch(`${t.origin}/api/site/settings`, token ? { headers: { authorization: `Bearer ${token}` } } : {});

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  manager = await signIn(t, "pat@example.com", "Pat", ["manager"]);
});
after(() => t.stop());

test("only admins see or change the website's settings", async () => {
  assert.match(textOf(await admin.page("/our-website")), /Is the website open\?/);
  assert.match(textOf(await admin.page("/")), /Our website/);
  assert.doesNotMatch(textOf(await manager.page("/our-website")), /Is the website open\?/);
  const refused = await manager.post("/our-website", { mode: "coming-soon" });
  assert.equal(problemOf(refused), "You don’t have permission to do that.");
  assert.equal(t.db.prepare("select mode from public_site_settings").get()?.["mode"], "live");
});

test("settings are checked, saved and recorded without secrets", async () => {
  assert.equal(problemOf(await admin.post("/our-website", { mode: "closed" })), "Choose open, coming soon or maintenance.");
  assert.equal(problemOf(await admin.post("/our-website", { mode: "live", bannerText: "Hi", bannerLinkText: "Go", bannerHref: "javascript:alert(1)" })), "A link starts with https:// or with a single /.");
  assert.equal(doneOf(await admin.post("/our-website", { mode: "coming-soon", title: "Coming soon", message: "Opening January 1.", eta: "January 1", bannerText: "", bannerLinkText: "", bannerHref: "" })), "Saved. The website follows within a minute.");
  assert.equal(t.db.prepare("select mode from public_site_settings").get()?.["mode"], "coming-soon");
  assert.ok(actions(t.db).includes("public-site.settings-changed"));
});

test("a preview link is made, shown to admins, and replaced by a new one", async () => {
  assert.equal(doneOf(await admin.post("/our-website/preview", {})), "New preview link made. The old one no longer works.");
  const first = t.db.prepare("select preview_token from public_site_settings").get()?.["preview_token"] as string;
  assert.ok(first.length >= 40);
  assert.ok(textOf(await admin.page("/our-website")).includes(`/?preview=${first}`));
  await admin.post("/our-website/preview", {});
  assert.notEqual(t.db.prepare("select preview_token from public_site_settings").get()?.["preview_token"], first);
  assert.equal(problemOf(await manager.post("/our-website/preview", {})), "You don’t have permission to do that.");
});

test("the website reads its settings with its token, and nothing else gets them", async () => {
  assert.match(textOf(await admin.page("/our-website")), /not connected to HQ yet/);
  assert.equal((await ask()).status, 401);
  assert.equal((await ask("nope")).status, 401);
  const token = issueSiteToken(t.services.publicSite);
  const got = await ask(token);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("cache-control"), "no-store");
  const body = (await got.json()) as { mode: string; title: string; banner: unknown; previewToken: string };
  assert.deepEqual([body.mode, body.title, body.banner], ["coming-soon", "Coming soon", null]);
  assert.ok(body.previewToken.length >= 40);
  assert.doesNotMatch(textOf(await admin.page("/our-website")), /not connected to HQ yet/);
  assert.equal((await ask(token + "x")).status, 401);
  const stored = JSON.stringify(t.db.prepare("select token_hash from public_site_settings").get());
  assert.ok(!stored.includes(token), "only a hash is kept");
  assert.ok(actions(t.db).includes("public-site.token-issued"));
});

test("a new token cuts off the old one", async () => {
  const old = issueSiteToken(t.services.publicSite);
  const next = issueSiteToken(t.services.publicSite);
  assert.equal((await ask(old)).status, 401);
  assert.equal((await ask(next)).status, 200);
});
