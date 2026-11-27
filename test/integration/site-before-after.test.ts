// Before-and-after pairs over real HTTP, with a stand-in for GitHub: a site
// whose content file has a `beforeAfter` list shows the section in the
// portal; the client adds a pair (two photos at once), rewords, reorders and
// removes one; Potomac publishes: one commit with the file, the two new
// photos, and the removed pair's photos gone, its other sizes too. A site
// without the section never shows it, and gains none.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { fakeSiteRepo, JPEG, WEBP } from "../support/fake-site-repo.ts";
import { clientSignedIn, events, httpClient, signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

const sized = (slug: string, stage: string) => ({ src: `/gallery/before-after/${slug}-${stage}-1600.webp`, srcSet: `/gallery/before-after/${slug}-${stage}-480.webp 480w, /gallery/before-after/${slug}-${stage}-1600.webp 1600w` });
const CONTENT = JSON.stringify({
  notice: "",
  gallery: [{ src: "/gallery/booth.webp", alt: "A clean paint booth", title: "Paint Booth" }],
  beforeAfter: [
    { title: "Ford F-250", caption: "Front bumper", before: { ...sized("f250", "before"), alt: "A torn bumper" }, after: { ...sized("f250", "after"), alt: "A straight bumper" } },
    { title: "Nissan Murano", caption: "Front fender", before: { ...sized("murano", "before"), alt: "A dented fender" }, after: { ...sized("murano", "after"), alt: "A smooth fender" } },
  ],
  testimonials: [],
});
const files: Record<string, string | Uint8Array> = { "src/content/site.json": CONTENT, "public/gallery/booth.webp": WEBP };
for (const slug of ["f250", "murano"]) for (const stage of ["before", "after"]) for (const width of [480, 1600]) files[`public/gallery/before-after/${slug}-${stage}-${width}.webp`] = WEBP;
const repo = fakeSiteRepo(files);
const plain = fakeSiteRepo({ "src/content/site.json": JSON.stringify({ notice: "", gallery: [{ src: "/gallery/truck.webp", alt: "A tow truck", title: "Truck" }] }), "public/gallery/truck.webp": WEBP });

let t: TestApp;
let admin: Client;
let dana: Client;
let stranger: Client;
let siteId = "";
const problemOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("done") ?? "";
type PairRow = { id: string; title: string; before: { id: string; alt: string }; after: { id: string; alt: string } };
const pairs = (): PairRow[] => {
  const row = t.db.prepare("select published, draft from content_site where id = ?").get(siteId) as { published: string; draft: string | null };
  return (JSON.parse(row.draft ?? row.published) as { pairs: PairRow[] }).pairs;
};
const pairId = (title: string) => pairs().find((one) => one.title === title)?.id ?? assert.fail(`no pair titled ${title}`);
const photoCount = () => Number(t.db.prepare("select count(*) as n from content_photo where site_id = ?").get(siteId)?.["n"]);
const WORDS = { title: "Subaru WRX", caption: "Front bumper and fender", beforeAlt: "A scraped bumper", afterAlt: "A clean bumper" };
const BOTH = [
  { field: "before", name: "before.jpg", bytes: JPEG },
  { field: "after", name: "after.jpg", bytes: JPEG },
];

before(async () => {
  t = await testApp({ sitePublisher: { read: (r, path) => (r.name === "plain-site" ? plain : repo).publisher.read(r, path), commit: (r, change) => (r.name === "plain-site" ? plain : repo).publisher.commit(r, change) } });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const clientId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Nu Finish Collision Center", sizeTier: "small" })).id;
  const otherId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Better Days Towing", sizeTier: "small" })).id;
  dana = await clientSignedIn(t, admin, clientId, "Dana Groves", "dana@nufinish.example");
  stranger = await clientSignedIn(t, admin, otherId, "Stacy Roberts", "stacy@betterdays.example");
  const made = await admin.post(`/clients/${clientId}/website`, { name: "Nu Finish website", repo: "Potomac-Solutions/example-site", branch: "main", contentPath: "src/content/site.json", photoDir: "public/gallery" });
  siteId = /\/websites\/([0-9a-f-]{36})/.exec(made.headers.get("location") ?? "")?.[1] ?? "";
  assert.ok(siteId, doneOf(made) || problemOf(made));
  await admin.post(`/clients/${otherId}/website`, { name: "Better Days website", repo: "Potomac-Solutions/plain-site", branch: "main", contentPath: "src/content/site.json", photoDir: "public/gallery" });
});
after(() => t.stop());

test("set up, HQ holds each pair's two photos; the client and Potomac both see the section", async () => {
  assert.equal(photoCount(), 5, "the gallery photo and two pairs' four");
  const page = textOf(await dana.page("/portal/website"));
  assert.match(page, /Before and after .* 1\. Ford F-250 Front bumper .* 2\. Nissan Murano Front fender .* Add a before and after/);
  assert.match(textOf(await admin.page(`/websites/${siteId}`)), /Before and after .* 1\. Ford F-250/);
  const before = pairs()[0]?.before.id ?? "";
  assert.equal((await dana.get(`/portal/website/photos/${before}`)).status, 200);
  assert.equal((await stranger.get(`/portal/website/photos/${before}`)).status, 404);
});

test("a site without the section never shows it", async () => {
  assert.doesNotMatch(textOf(await stranger.page("/portal/website")), /Before and after/);
  assert.equal(problemOf(await stranger.upload("/portal/website/before-after", WORDS, BOTH)), "This website doesn’t show before and after photos.");
});

test("the client adds a pair with both photos and its words; one missing refuses the whole pair", async () => {
  assert.equal(problemOf(await dana.upload("/portal/website/before-after", WORDS, [BOTH[0]!])), "Choose a photo first.");
  assert.equal(problemOf(await dana.upload("/portal/website/before-after", WORDS, [BOTH[0]!, { field: "after", name: "notes.jpg", bytes: new TextEncoder().encode("no") }])), "That file isn’t a JPEG, PNG or WebP photo.");
  assert.equal(problemOf(await dana.upload("/portal/website/before-after", { ...WORDS, afterAlt: "" }, BOTH)), "Say what the after photo shows, for someone who can’t see it.");
  assert.equal(photoCount(), 5, "a refused pair keeps neither photo");
  assert.equal(doneOf(await dana.upload("/portal/website/before-after", WORDS, BOTH)), "Before and after added. It isn’t on your website until you send your changes.");
  assert.equal(photoCount(), 7);
  const wrx = pairs().find((one) => one.title === "Subaru WRX");
  assert.ok(wrx);
  assert.equal((await dana.get(`/portal/website/photos/${wrx.after.id}`)).headers.get("content-type"), "image/jpeg");

  assert.match(doneOf(await dana.post(`/portal/website/before-after/${wrx.id}/move`, { to: "first" })), /^Moved\./);
  assert.match(doneOf(await dana.post(`/portal/website/before-after/${pairId("Ford F-250")}`, { title: "Ford F-250 Super Duty", caption: "Front bumper", beforeAlt: "A torn bumper", afterAlt: "A straight bumper" })), /^Saved\./);
  assert.match(doneOf(await dana.post(`/portal/website/before-after/${pairId("Nissan Murano")}/remove`, {})), /^Before and after removed\./);
  assert.match(textOf(await dana.page("/portal/website")), /What you’ve changed: New before and after: Subaru WRX Before and after removed: Nissan Murano Words changed on a before and after: Ford F-250 Super Duty A different before and after comes first/);
  assert.match(textOf(await dana.page("/portal/website")), /1\. Subaru WRX New Front bumper and fender/);
  assert.equal(repo.commits.length, 0);
  assert.ok(events(t.db).some((event) => event.action === "site-content.pair-added" && event.context["by"] === "client"));
});

test("nobody changes another client's pairs, even knowing the id", async () => {
  const ford = pairId("Ford F-250 Super Duty");
  // Another client's own site is the only one they can reach, and the pair isn't on it.
  assert.equal(problemOf(await stranger.post(`/portal/website/before-after/${ford}/remove`, {})), "That before and after isn’t there any more.");
  assert.equal(problemOf(await httpClient(t.origin).post(`/portal/website/before-after/${ford}/remove`, {}, { origin: t.origin })), "That doesn’t exist.");
  assert.equal(problemOf(await dana.post(`/websites/before-after/${ford}/remove`, { siteId })), "You don’t have permission to do that.");
  assert.ok(pairs().some((one) => one.id === ford));
});

test("published: one commit with the file and the new photos; the removed pair's photos go, other sizes too", async () => {
  // Potomac fixes a word from HQ first.
  assert.equal(doneOf(await admin.post(`/websites/before-after/${pairId("Subaru WRX")}`, { siteId, ...WORDS, caption: "Front bumper and left fender" })), "Saved.");
  assert.equal(problemOf(await admin.post(`/websites/before-after/${pairId("Subaru WRX")}`, { ...WORDS })), "That doesn’t exist.", "with no site named");
  assert.match(doneOf(await admin.post(`/websites/${siteId}/publish`, {})), /^Published\./);
  const commit = repo.commits[0];
  assert.equal(commit?.wrote.length, 3, "the content file and two new photos");
  assert.deepEqual([...(commit?.removed ?? [])].sort(), ["public/gallery/before-after/murano-after-1600.webp", "public/gallery/before-after/murano-after-480.webp", "public/gallery/before-after/murano-before-1600.webp", "public/gallery/before-after/murano-before-480.webp"]);
  assert.match(commit?.message ?? "", /- New before and after: Subaru WRX\n- Before and after removed: Nissan Murano\n/);
  assert.equal(repo.has("public/gallery/before-after/f250-before-480.webp"), true, "a kept pair keeps its sizes");
  const file = JSON.parse(repo.text("src/content/site.json")) as { beforeAfter: { title: string; caption?: string; before: Record<string, string>; after: Record<string, string> }[] };
  assert.deepEqual(file.beforeAfter.map((pair) => pair.title), ["Subaru WRX", "Ford F-250 Super Duty"]);
  assert.equal(file.beforeAfter[0]?.caption, "Front bumper and left fender");
  assert.match(file.beforeAfter[0]?.before["src"] ?? "", /^\/gallery\/hq-[0-9a-f]{12}\.jpg$/);
  assert.equal(file.beforeAfter[1]?.before["srcSet"], sized("f250", "before").srcSet, "what HQ doesn't know is kept");
  assert.equal(photoCount(), 5);
});

test("removing every pair empties the list; the site keeps the section's place and hides it", async () => {
  for (const one of pairs()) assert.match(doneOf(await admin.post(`/websites/before-after/${one.id}/remove`, { siteId })), /^Before and after removed\./);
  assert.match(textOf(await admin.page(`/websites/${siteId}`)), /Before and after .* None yet\./);
  await admin.post(`/websites/${siteId}/publish`, {});
  assert.deepEqual((JSON.parse(repo.text("src/content/site.json")) as { beforeAfter: unknown[] }).beforeAfter, []);
  assert.equal(photoCount(), 1);
});
