// A site's status over real HTTP, with a stand-in for GitHub: the client
// sets their site to "coming soon" with an opening time, and it is on the
// site at once: one commit with the status and nothing else. The preview
// link's key never reaches the site, only its hash. Changes waiting to be
// checked stay waiting.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { fakeSiteRepo, WEBP } from "../support/fake-site-repo.ts";
import { clientSignedIn, events, httpClient, signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

const CONTENT = JSON.stringify({ notice: "", gallery: [{ src: "/gallery/booth.webp", alt: "A clean paint booth", title: "Paint Booth" }], testimonials: [] });
const repo = fakeSiteRepo({ "src/content/site.json": CONTENT, "public/gallery/booth.webp": WEBP });
const SETUP = { name: "Nu Finish website", repo: "Potomac-Solutions/example-site", branch: "main", contentPath: "src/content/site.json", photoDir: "public/gallery" };
const SOON = { mode: "coming-soon", opensOn: "2099-01-01", opensTime: "00:00", message: "Call us in the meantime." };

let t: TestApp;
let admin: Client;
let member: Client;
let dana: Client;
let stranger: Client;
let siteId = "";
const problemOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("done") ?? "";
const launchInFile = () => (JSON.parse(repo.text("src/content/site.json")) as { launch?: Record<string, string> }).launch;
const previewKey = () => t.db.prepare("select preview_key from content_site where id = ?").get(siteId)?.["preview_key"] as string | null;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

before(async () => {
  t = await testApp({ sitePublisher: repo.publisher });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  member = await signIn(t, "sam@example.com", "Sam Teter", ["member"]);
  await member.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const clientId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Nu Finish Collision Center", sizeTier: "small" })).id;
  const otherId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Gormania Feed", sizeTier: "small" })).id;
  dana = await clientSignedIn(t, admin, clientId, "Dana Groves", "dana@nufinish.example");
  stranger = await clientSignedIn(t, admin, otherId, "Bob Miller", "bob@gormaniafeed.example");
  assert.equal(problemOf(await admin.post(`/clients/${clientId}/website`, { ...SETUP, siteUrl: "http://plain.example" })), "Enter the site’s address, like nufinishcollision.com. It must be an https address.");
  const made = await admin.post(`/clients/${clientId}/website`, SETUP);
  siteId = /\/websites\/([0-9a-f-]{36})/.exec(made.headers.get("location") ?? "")?.[1] ?? "";
  assert.ok(siteId);
});
after(() => t.stop());

test("a site starts open; an opening time must be whole and still ahead", async () => {
  assert.match(textOf(await dana.page("/portal/website")), /Is the website open\? Open Open to everyone\./);
  assert.match(textOf(await dana.page("/portal")), /Your website Nu Finish website Open to everyone\./);
  assert.equal(problemOf(await dana.post("/portal/website/status", { mode: "live" })), "Nothing changed.");
  assert.equal(problemOf(await dana.post("/portal/website/status", { mode: "closed" })), "Choose what visitors see.");
  assert.equal(problemOf(await dana.post("/portal/website/status", { mode: "coming-soon", opensOn: "2099-01-01" })), "Enter the time of day too. Midnight is 12:00 AM.");
  assert.equal(problemOf(await dana.post("/portal/website/status", { mode: "coming-soon", opensOn: "2020-01-01", opensTime: "00:00" })), "That time has already passed. Choose a later one, or choose “The website” to open it now.");
  assert.equal(repo.commits.length, 0);
});

test("the client sets 'coming soon' with an opening time: on the site at once, in one commit of the status alone", async () => {
  // A change is waiting to be checked. It must not go out with the status.
  await dana.post("/portal/website/notice", { notice: "Grand opening soon." });
  assert.equal(doneOf(await dana.post("/portal/website/status", SOON)), "Saved. Your website updates in a minute or two.");
  assert.equal(repo.commits.length, 1);
  assert.deepEqual(repo.commits[0]?.wrote, ["src/content/site.json"]);
  assert.match(repo.commits[0]?.message ?? "", /^Site status: coming soon, opens 2099-01-01T05:00:00Z\n\nSet from Potomac HQ\.$/);
  const file = JSON.parse(repo.text("src/content/site.json")) as { notice: string; gallery: unknown[] };
  assert.equal(file.notice, "", "the waiting notice is still waiting");
  assert.equal(file.gallery.length, 1);
  const key = previewKey();
  assert.match(key ?? "", /^[0-9a-f]{32}$/);
  assert.deepEqual(launchInFile(), { mode: "coming-soon", opensAt: "2099-01-01T05:00:00Z", timeZone: "America/New_York", message: "Call us in the meantime.", previewKeyHash: sha256(key ?? "") });
  assert.ok(!repo.text("src/content/site.json").includes(key ?? "x"), "the key itself never reaches the site");
  assert.equal(t.db.prepare("select draft_state from content_site where id = ?").get(siteId)?.["draft_state"], "editing");

  const page = textOf(await dana.page("/portal/website"));
  assert.match(page, /Is the website open\? Coming soon Visitors see “Coming soon”\. It opens by itself on Thursday, January 1, 2099 at 12:00 AM\./);
  assert.match(page, /Potomac Solutions will send you a link to preview your website\./, "no address yet, so no link");
  assert.match(await dana.page("/portal/website"), /name="opensOn"[^>]*value="2099-01-01"|value="2099-01-01"[^>]*name="opensOn"/);
  const changed = events(t.db).find((event) => event.action === "site-content.status-changed");
  assert.equal(changed?.actor, null);
  assert.equal(changed?.context["mode"], "coming-soon");
  assert.match(textOf(await admin.page("/")), /Dana Groves \(Nu Finish Collision Center\) set their website to “Coming soon”/);
});

test("with the site's address, both sides get a preview link carrying the key; a new link replaces it on the site", async () => {
  assert.equal(problemOf(await member.post(`/websites/${siteId}/address`, { siteUrl: "nufinishcollision.com" })), "You don’t have permission to do that.");
  assert.equal(doneOf(await admin.post(`/websites/${siteId}/address`, { siteUrl: "nufinishcollision.com/" })), "Saved.");
  const key = previewKey() ?? "";
  const link = `https://nufinishcollision.com/?preview=${key}`;
  assert.ok((await dana.page("/portal/website")).includes(`href="${link}"`));
  assert.ok((await admin.page(`/websites/${siteId}`)).includes(`href="${link}"`));
  assert.equal(repo.commits.length, 1, "the address is HQ's own: nothing to commit");

  assert.equal(doneOf(await dana.post("/portal/website/preview-link", {})), "New preview link made. The old one no longer works.");
  const next = previewKey() ?? "";
  assert.notEqual(next, key);
  assert.equal(repo.commits.length, 2);
  assert.equal(launchInFile()?.["previewKeyHash"], sha256(next));
  assert.ok(!(await dana.page("/portal/website")).includes(key));
});

test("publishing the waiting changes keeps the status; Potomac can close and open the site too", async () => {
  await dana.post("/portal/website/submit", {});
  assert.match(doneOf(await admin.post(`/websites/${siteId}/publish`, {})), /^Published\./);
  const file = JSON.parse(repo.text("src/content/site.json")) as { notice: string; launch: Record<string, string> };
  assert.equal(file.notice, "Grand opening soon.");
  assert.equal(file.launch["mode"], "coming-soon");
  assert.equal(file.launch["previewKeyHash"], sha256(previewKey() ?? ""));

  assert.equal(doneOf(await admin.post(`/websites/${siteId}/status`, { mode: "maintenance" })), "Saved. The website updates in a minute or two.");
  assert.deepEqual(launchInFile(), { mode: "maintenance", timeZone: "America/New_York", previewKeyHash: sha256(previewKey() ?? "") });
  assert.match(textOf(await dana.page("/portal/website")), /Closed for maintenance Visitors see “Closed for maintenance” until someone opens it\./);
  assert.equal(doneOf(await dana.post("/portal/website/status", { mode: "live", opensOn: "2099-01-01", opensTime: "00:00" })), "Saved. Your website updates in a minute or two.");
  assert.deepEqual(launchInFile(), { mode: "live" });
  assert.match(textOf(await admin.page(`/websites/${siteId}`)), /Is the website open\? Open Open to everyone\./);
  assert.match(textOf(await admin.page("/")), /Dana Groves \(Nu Finish Collision Center\) opened their website to everyone/);
});

test("nobody else changes a site's status, and GitHub refusing leaves it as it was", async () => {
  for (const who of [stranger, httpClient(t.origin)]) {
    assert.equal(problemOf(await who.post("/portal/website/status", SOON, { origin: t.origin })), "That doesn’t exist.");
    assert.equal(problemOf(await who.post("/portal/website/preview-link", {}, { origin: t.origin })), "That doesn’t exist.");
  }
  assert.equal(problemOf(await member.post(`/websites/${siteId}/status`, SOON)), "You don’t have permission to do that.");
  assert.equal(problemOf(await dana.post(`/websites/${siteId}/status`, SOON)), "You don’t have permission to do that.");
  const before = repo.commits.length;
  repo.state.failWith = "repo-refused";
  assert.match(problemOf(await dana.post("/portal/website/status", SOON)), /^GitHub refused\./);
  repo.state.failWith = null;
  assert.equal(repo.commits.length, before);
  assert.equal(t.db.prepare("select launch_mode from content_site where id = ?").get(siteId)?.["launch_mode"], "live");
});

test("a status already in the site's file is read when the site is read again", async () => {
  repo.set("src/content/site.json", repo.text("src/content/site.json").replace('"mode": "live"', '"mode": "maintenance", "message": "Back Monday."'));
  assert.equal(doneOf(await admin.post(`/websites/${siteId}/read-again`, {})), "Read again. This is what is on the site now.");
  assert.match(textOf(await admin.page(`/websites/${siteId}`)), /Closed for maintenance Visitors see “Closed for maintenance” until someone opens it\./);
  assert.match(await admin.page(`/websites/${siteId}`), /value="Back Monday\."/);
});

test("a site already closed when it is set up has no preview link yet, and either side can make one", async () => {
  const otherId = t.db.prepare("select id from client_organization where name = 'Gormania Feed'").get()?.["id"] as string;
  assert.equal(problemOf(await admin.post(`/clients/${otherId}/website`, { ...SETUP, repo: "potomac-solutions/EXAMPLE-SITE" })), "That repository’s content file is already set up for another client.");
  // A site started as a copy of Nu Finish's: its file still carries Nu Finish's photo ids.
  const made = await admin.post(`/clients/${otherId}/website`, { ...SETUP, repo: "Potomac-Solutions/feed-store-site", name: "Feed store website", siteUrl: "gormaniafeed.example" });
  const second = /\/websites\/([0-9a-f-]{36})/.exec(made.headers.get("location") ?? "")?.[1] ?? "";
  assert.ok(second, `${made.status} ${made.headers.get("location")}`);
  assert.equal(t.db.prepare("select count(*) as n from content_photo where site_id = ?").get(second)?.["n"], 1, "its photo got an id of its own");
  const keyOf = () => t.db.prepare("select preview_key from content_site where id = ?").get(second)?.["preview_key"] as string | null;
  assert.equal(keyOf(), null);
  const page = textOf(await stranger.page("/portal/website"));
  assert.match(page, /Closed for maintenance .* Make a preview link This site was closed before HQ knew it/);
  assert.doesNotMatch(page, /Make a new preview link/);
  assert.equal(doneOf(await stranger.post("/portal/website/preview-link", {})), "New preview link made. The old one no longer works.");
  assert.equal(launchInFile()?.["previewKeyHash"], sha256(keyOf() ?? ""));
  assert.ok((await stranger.page("/portal/website")).includes(`href="https://gormaniafeed.example/?preview=${keyOf()}"`));
});
