// A site's service area over real HTTP, with a stand-in for GitHub. The site
// has no photo gallery, only a service area: it is set up all the same, and
// the client sees the map, not photos. Saving takes effect at once, in one
// commit of the content file. A county's outline is HQ's own; a drawn area
// is the client's. With scripts off, the ticked counties are saved and drawn
// areas kept.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { fakeSiteRepo } from "../support/fake-site-repo.ts";
import { clientSignedIn, events, signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

const GARRETT = "24023";
const ALLEGANY = "24001";
const LAKE = [[-79.42, 39.48], [-79.3, 39.48], [-79.3, 39.6], [-79.42, 39.6]];
const START = { serviceArea: { areas: [{ name: "Garrett County", county: GARRETT, ring: [[-79.48, 39.72], [-79.07, 39.72], [-79.07, 39.48], [-79.49, 39.21]] }] }, theme: "night" };
const repo = fakeSiteRepo({ "src/content/site.json": JSON.stringify(START) });
const SETUP = { name: "Better Days website", repo: "Potomac-Solutions/better-days-towing", branch: "main", contentPath: "src/content/site.json", photoDir: "public/gallery" };

type File = { serviceArea: { areas: { name: string; county?: string; ring: number[][] }[] }; theme: string; gallery?: unknown; launch?: unknown };
let t: TestApp;
let admin: Client;
let stacy: Client;
let stranger: Client;
let siteId = "";
const problemOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("done") ?? "";
const file = () => JSON.parse(repo.text("src/content/site.json")) as File;

before(async () => {
  t = await testApp({ sitePublisher: repo.publisher });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const clientId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Better Days Towing", sizeTier: "small" })).id;
  const otherId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Gormania Feed", sizeTier: "small" })).id;
  stacy = await clientSignedIn(t, admin, clientId, "Stacy Roberts", "stacy@betterdays.example");
  stranger = await clientSignedIn(t, admin, otherId, "Bob Miller", "bob@gormaniafeed.example");
  const made = await admin.post(`/clients/${clientId}/website`, SETUP);
  siteId = /\/websites\/([0-9a-f-]{36})/.exec(made.headers.get("location") ?? "")?.[1] ?? "";
  assert.ok(siteId, `set up: ${problemOf(made)}`);
});
after(() => t.stop());

test("a site with no gallery is set up; the client sees where they go on a map, and no photos, notice or reviews", async () => {
  const html = await stacy.page("/portal/website");
  const page = textOf(html);
  assert.match(page, /Where you go Garrett County\. Your website shows these on a map/);
  assert.doesNotMatch(page, /Photos|Reviews|Send to Potomac Solutions/);
  assert.match(html, /name="county-24023" value="1"[^>]*checked|checked[^>]*name="county-24023"/, "Garrett is ticked");
  assert.match(html, /name="county-24001"/, "Allegany, next door, is on the map");
  assert.match(textOf(await stacy.page("/portal")), /Change where you go, on the map\./);
  assert.equal(problemOf(await stacy.post("/portal/website/notice", { notice: "Hello" })), "This website has no photos, notice or reviews to change.");
});

test("saved with the map's areas: on the site at once, one commit, the county's outline HQ's own and the drawn area as drawn", async () => {
  const areas = JSON.stringify([{ county: GARRETT }, { county: ALLEGANY, ring: [[0, 0], [1, 1], [2, 0]] }, { name: "Deep Creek Lake and around", ring: LAKE }]);
  assert.equal(doneOf(await stacy.post("/portal/website/service-area", { areas })), "Saved. The map on your website updates in a minute or two.");
  assert.equal(repo.commits.length, 1);
  assert.deepEqual(repo.commits[0]?.wrote, ["src/content/site.json"]);
  assert.match(repo.commits[0]?.message ?? "", /^Service area: Garrett County, Allegany County and Deep Creek Lake and around\n\nSet from Potomac HQ\.$/);
  const written = file();
  assert.deepEqual(written.serviceArea.areas.map((one) => [one.name, one.county ?? null]), [["Garrett County", GARRETT], ["Allegany County", ALLEGANY], ["Deep Creek Lake and around", null]]);
  assert.ok((written.serviceArea.areas[1]?.ring.length ?? 0) > 10, "Allegany's outline came from HQ, not the three points sent");
  assert.deepEqual(written.serviceArea.areas[2]?.ring, LAKE);
  assert.equal(written.theme, "night", "the rest of the file is kept");
  assert.equal(written.gallery, undefined, "no gallery is added to a site that has none");
  const changed = events(t.db).find((event) => event.action === "site-content.service-area-changed");
  assert.equal(changed?.actor, null);
  assert.equal(changed?.context["areas"], 3);
  assert.match(textOf(await admin.page("/")), /Stacy Roberts \(Better Days Towing\) changed the service area on their website/);
  assert.match(textOf(await admin.page(`/websites/${siteId}`)), /Service area Garrett County, Allegany County and Deep Creek Lake and around\./);
});

test("the same areas again change nothing; what can't be read, or is too big, is refused and nothing is committed", async () => {
  const same = JSON.stringify([{ county: GARRETT }, { county: ALLEGANY }, { name: "Deep Creek Lake and around", ring: LAKE }]);
  assert.equal(problemOf(await stacy.post("/portal/website/service-area", { areas: same })), "Nothing changed.");
  assert.equal(problemOf(await stacy.post("/portal/website/service-area", { areas: "{" })), "The map sent something HQ couldn’t read. Reload the page and try again.");
  assert.equal(problemOf(await stacy.post("/portal/website/service-area", { areas: JSON.stringify([{ name: "", ring: LAKE }]) })), "Give each area you drew a name, like Deep Creek Lake and around.");
  assert.equal(problemOf(await stacy.post("/portal/website/service-area", { areas: JSON.stringify([{ name: "All of it", ring: [[-90, 30], [-70, 30], [-70, 45]] }]) })), "That area stretches hundreds of miles. Draw it again, closer in.");
  assert.equal(problemOf(await stacy.post("/portal/website/service-area", { areas: JSON.stringify([{ county: "06037" }]) })), "HQ doesn’t have the outline of one of those counties. Draw that area instead.");
  assert.equal(repo.commits.length, 1);
});

test("with scripts off, the ticked counties are saved and the drawn area is kept", async () => {
  assert.equal(doneOf(await stacy.post("/portal/website/service-area", { [`county-${GARRETT}`]: "1" })), "Saved. The map on your website updates in a minute or two.");
  assert.deepEqual(file().serviceArea.areas.map((one) => one.name), ["Garrett County", "Deep Creek Lake and around"]);
});

test("nobody else changes it; Potomac can; GitHub refusing leaves it as it was", async () => {
  const before = repo.commits.length;
  assert.equal(problemOf(await stranger.post("/portal/website/service-area", { areas: "[]" })), "That doesn’t exist.");
  repo.state.failWith = "repo-refused";
  assert.match(problemOf(await admin.post(`/websites/${siteId}/service-area`, { areas: JSON.stringify([{ county: ALLEGANY }]) })), /^GitHub refused\./);
  repo.state.failWith = null;
  assert.equal(repo.commits.length, before);
  assert.equal(doneOf(await admin.post(`/websites/${siteId}/service-area`, { areas: JSON.stringify([{ county: ALLEGANY }]) })), "Saved. The website’s map updates in a minute or two.");
  assert.deepEqual(file().serviceArea.areas.map((one) => one.county), [ALLEGANY]);
  const changed = events(t.db).filter((event) => event.action === "site-content.service-area-changed").at(-1);
  assert.notEqual(changed?.actor, null, "Potomac's change is theirs");
});

test("changing whether the site is open keeps the service area in the file", async () => {
  assert.equal(doneOf(await stacy.post("/portal/website/status", { mode: "maintenance" })), "Saved. Your website updates in a minute or two.");
  const written = file();
  assert.deepEqual(written.serviceArea.areas.map((one) => one.county), [ALLEGANY]);
  assert.deepEqual((written.launch as { mode: string }).mode, "maintenance");
});

test("the map can be stepped out", async () => {
  const near = await stacy.page("/portal/website");
  const wide = await stacy.page("/portal/website?wider=2");
  const counties = (html: string) => (html.match(/name="county-\d{5}"/g) ?? []).length;
  assert.ok(counties(wide) > counties(near), `${counties(wide)} counties on the wider map, ${counties(near)} close in`);
  assert.match(wide, /href="\/portal\/website\?wider=3#service-area"/);
});
