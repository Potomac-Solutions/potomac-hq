// Website content over real HTTP, with a stand-in for GitHub: a manager
// sets a client's site up, the client changes it in the portal and sends
// the changes in, Potomac sends them back once, then publishes: one commit
// with the content file, the new photo, and the removed photo gone. Nothing
// a client does reaches the site by itself, and nobody reaches another
// client's site.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import { setUpSite } from "../../src/websites/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { fakeSiteRepo, JPEG, WEBP } from "../support/fake-site-repo.ts";
import { actions, clientSignedIn, count, events, httpClient, signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

const CONTENT = JSON.stringify({
  notice: "",
  gallery: [
    { src: "/gallery/booth.webp", alt: "A clean paint booth", title: "Paint Booth", caption: "Where refinishing happens.", focus: "50% 22%" },
    { src: "/gallery/parts.webp", alt: "Shelves of parts", title: "Parts Bay" },
  ],
  testimonials: [{ quote: "They made it easy.", by: "Evelyn S. · via Yelp" }],
});
const repo = fakeSiteRepo({ "src/content/site.json": CONTENT, "public/gallery/booth.webp": WEBP, "public/gallery/parts.webp": WEBP });

let t: TestApp;
let admin: Client;
let member: Client;
let dana: Client;
let stranger: Client;
let mikey: Id;
let clientId: Id;
let otherId: Id;
let siteId = "";
const problemOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("done") ?? "";
const photoId = (title: string) => {
  const row = t.db.prepare("select published, draft from content_site where id = ?").get(siteId) as { published: string; draft: string | null };
  const gallery = (JSON.parse(row.draft ?? row.published) as { gallery: { id: string; title: string }[] }).gallery;
  return gallery.find((one) => one.title === title)?.id ?? assert.fail(`no photo titled ${title}`);
};
const state = () => t.db.prepare("select draft_state from content_site where id = ?").get(siteId)?.["draft_state"];
const SETUP = { name: "Nu Finish website", repo: "Potomac-Solutions/nu-finish-site", branch: "main", contentPath: "src/content/site.json", photoDir: "public/gallery" };

before(async () => {
  t = await testApp({ sitePublisher: repo.publisher });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  member = await signIn(t, "sam@example.com", "Sam Teter", ["member"]);
  await member.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  clientId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Nu Finish Collision Center", sizeTier: "small" })).id;
  otherId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Gormania Feed", sizeTier: "small" })).id;
  dana = await clientSignedIn(t, admin, clientId, "Dana Groves", "dana@nufinish.example");
  stranger = await clientSignedIn(t, admin, otherId, "Bob Miller", "bob@gormaniafeed.example");
});
after(() => t.stop());

test("a site is set up on its client's page by reading its repository; what can't be read is said plainly", async () => {
  assert.match(textOf(await admin.page(`/clients/${clientId}`)), /Website editing Let this client change their own site’s photos, notice and reviews/);
  assert.equal(problemOf(await admin.post(`/clients/${clientId}/website`, { ...SETUP, repo: "nu-finish-site" })), "Enter the repository as owner/name, like Potomac-Solutions/nu-finish-site.");
  assert.equal(problemOf(await admin.post(`/clients/${clientId}/website`, { ...SETUP, contentPath: "../../etc/passwd.json" })), "The content file is a path to a .json file in the repository, like src/content/site.json.");
  assert.match(problemOf(await admin.post(`/clients/${clientId}/website`, { ...SETUP, contentPath: "src/content/missing.json" })), /^GitHub has no such repository, branch or file/);
  assert.match(problemOf(await admin.post(`/clients/${clientId}/website`, { ...SETUP, photoDir: "static" })), /^A photo named in the content file isn’t in the repository/);
  assert.equal(problemOf(await member.post(`/clients/${clientId}/website`, SETUP)), "You don’t have permission to do that.");
  assert.deepEqual(await setUpSite({ ...t.services.websites, publisher: null }, mikey, clientId, SETUP), { ok: false, error: "github-not-set-up" });
  assert.equal(count(t.db, "content_site"), 0);

  const made = await admin.post(`/clients/${clientId}/website`, SETUP);
  assert.match(doneOf(made), /^Set up\. HQ read the site’s photos, notice and reviews\./);
  siteId = /\/websites\/([0-9a-f-]{36})/.exec(made.headers.get("location") ?? "")?.[1] ?? "";
  assert.ok(siteId);
  assert.equal(problemOf(await admin.post(`/clients/${clientId}/website`, SETUP)), "This client’s site is already set up.");
  assert.equal(count(t.db, "content_photo"), 2);
  const page = textOf(await admin.page(`/websites/${siteId}`));
  assert.match(page, /Nu Finish website Nothing is waiting/);
  assert.match(page, /1\. Paint Booth Where refinishing happens\. For someone who can’t see it: A clean paint booth/);
  assert.match(page, /2\. Parts Bay/);
  assert.match(page, /“They made it easy\.” Evelyn S\. · via Yelp/);
  assert.match(page, /Repository Potomac-Solutions\/nu-finish-site , branch main/);
  assert.match(textOf(await admin.page("/websites")), /Site content .* Nothing to check Nu Finish website · Nu Finish Collision Center Up to date/);
  assert.ok(actions(t.db).includes("site-content.set-up"));
});

test("the client sees their site in the portal, with its photos; nobody else does", async () => {
  assert.match(textOf(await dana.page("/portal")), /Your website Nu Finish website Change the photos, post a notice, or add a review\. Update your website/);
  assert.doesNotMatch(textOf(await stranger.page("/portal")), /Your website/);
  const page = textOf(await dana.page("/portal/website"));
  assert.match(page, /Nu Finish website This is what’s on your website now/);
  assert.match(page, /1\. Paint Booth/);
  assert.doesNotMatch(page, /Repository|Publish|GitHub/, "nothing of how it is published");
  const booth = photoId("Paint Booth");
  const shown = await dana.get(`/portal/website/photos/${booth}`);
  assert.equal(shown.status, 200);
  assert.equal(shown.headers.get("content-type"), "image/webp");
  assert.deepEqual(new Uint8Array(await shown.arrayBuffer()), WEBP);
  assert.equal((await stranger.get(`/portal/website/photos/${booth}`)).status, 404, "another client");
  assert.equal((await httpClient(t.origin).get(`/portal/website/photos/${booth}`)).status, 404, "signed out");
  assert.equal((await stranger.get("/portal/website")).status, 404, "a client with no site");
  assert.equal((await admin.get(`/websites/photos/${booth}`)).status, 200);
  assert.equal((await member.get(`/websites/photos/${booth}`)).status, 404, "someone who may not publish");
  assert.equal((await dana.get(`/websites/photos/${booth}`)).status, 404, "a client at HQ's own address");
});

test("the client adds a photo, changes words, reorders, posts a notice and a review; none of it reaches the site", async () => {
  const fields = { title: "Red truck", alt: "A red pickup with its front fender repaired", caption: "Back on the road." };
  assert.equal(problemOf(await dana.upload("/portal/website/photos", fields, { field: "photo", name: "notes.jpg", bytes: new TextEncoder().encode("not a photo") })), "That file isn’t a JPEG, PNG or WebP photo.");
  const big = new Uint8Array(3 * 1024 * 1024 + 1);
  big.set(JPEG);
  assert.match(problemOf(await dana.upload("/portal/website/photos", fields, { field: "photo", name: "big.jpg", bytes: big })), /^That photo is too big for a web page\./);
  assert.equal((await dana.upload("/portal/website/photos", fields, { field: "photo", name: "huge.jpg", bytes: new Uint8Array(4 * 1024 * 1024) })).status, 413, "past the form's own limit");
  assert.equal(problemOf(await dana.upload("/portal/website/photos", { ...fields, alt: "" }, { field: "photo", name: "truck.jpg", bytes: JPEG })), "Say what the photo shows, for someone who can’t see it.");
  assert.equal(count(t.db, "content_photo"), 2, "a refused photo is not kept");
  assert.equal(state(), "none");

  assert.equal(doneOf(await dana.upload("/portal/website/photos", fields, { field: "photo", name: "../../truck.JPG", bytes: JPEG })), "Photo added. It isn’t on your website until you send your changes.");
  const truck = photoId("Red truck");
  assert.match(String(t.db.prepare("select path from content_photo where id = ?").get(truck)?.["path"]), /^public\/gallery\/hq-[0-9a-f]{12}\.jpg$/, "its name on the site is HQ's, never the one it came with");
  assert.equal((await dana.get(`/portal/website/photos/${truck}`)).headers.get("content-type"), "image/jpeg");
  assert.equal(doneOf(await dana.post(`/portal/website/photos/${truck}/move`, { to: "first" })), "Moved. It isn’t on your website until you send your changes.");
  assert.equal(problemOf(await dana.post(`/portal/website/photos/${truck}/move`, { to: "up" })), "Nothing changed.");
  assert.match(doneOf(await dana.post(`/portal/website/photos/${photoId("Parts Bay")}`, { title: "Parts", alt: "Shelves of parts", caption: "" })), /^Saved\./);
  assert.match(doneOf(await dana.post(`/portal/website/photos/${photoId("Paint Booth")}/remove`, {})), /^Photo removed\./);
  assert.equal(problemOf(await dana.post("/portal/website/notice", { notice: "x".repeat(161) })), "Keep the notice under 160 characters.");
  assert.match(doneOf(await dana.post("/portal/website/notice", { notice: "Closed Thursday and Friday for Thanksgiving." })), /^Saved\./);
  assert.match(doneOf(await dana.post("/portal/website/reviews", { quote: "Looks brand new.", by: "Dale P." })), /^Review added\./);

  const page = textOf(await dana.page("/portal/website"));
  assert.match(page, /Your changes aren’t on your website yet What you’ve changed: New photo: Red truck Photo removed: Paint Booth Words changed on a photo: Parts A different photo comes first Notice: “Closed Thursday and Friday for Thanksgiving\.” New review from Dale P\. Send to Potomac Solutions Undo all my changes/);
  assert.match(page, /1\. Red truck New Back on the road\./);
  assert.equal(state(), "editing");
  assert.equal(repo.commits.length, 0);
  assert.equal(repo.text("src/content/site.json"), CONTENT);
});

test("another client, or someone signed out, cannot change this site, even knowing a photo's id", async () => {
  const truck = photoId("Red truck");
  for (const who of [stranger, httpClient(t.origin)]) {
    assert.equal(problemOf(await who.post(`/portal/website/photos/${truck}/remove`, {}, { origin: t.origin })), "That doesn’t exist.");
    assert.equal(problemOf(await who.post(`/portal/website/photos/${truck}`, { title: "Mine", alt: "Mine" }, { origin: t.origin })), "That doesn’t exist.");
    assert.equal(problemOf(await who.post("/portal/website/notice", { notice: "Hacked" }, { origin: t.origin })), "That doesn’t exist.");
    assert.equal(problemOf(await who.post("/portal/website/submit", {}, { origin: t.origin })), "That doesn’t exist.");
  }
  // HQ's own addresses take HQ's own people only.
  assert.equal(problemOf(await dana.post(`/websites/${siteId}/publish`, {})), "You don’t have permission to do that.");
  assert.equal(problemOf(await dana.post(`/websites/${siteId}/notice`, { notice: "Mine" })), "You don’t have permission to do that.");
  assert.equal(photoId("Red truck"), truck);
  assert.equal(state(), "editing");
});

test("sent in, Potomac is told and sees what to check; sent back with a note, the client is the one waited on", async () => {
  assert.equal(doneOf(await dana.post("/portal/website/submit", {})), "Sent to Potomac Solutions. We’ll check your changes and put them on your website.");
  assert.equal(problemOf(await dana.post("/portal/website/submit", {})), "These changes have already been sent.");
  assert.match(textOf(await dana.page("/portal/website")), /Sent to Potomac Solutions Sent by Dana Groves, .*\. We’ll check your changes/);
  assert.match(textOf(await dana.page("/portal")), /Your changes are with Potomac Solutions to check\./);
  const sent = events(t.db).find((event) => event.action === "site-content.submitted");
  assert.equal(sent?.actor, null);
  assert.equal(sent?.record, siteId);
  assert.match(textOf(await admin.page("/")), /Dana Groves \(Nu Finish Collision Center\) sent changes for their website/);
  assert.match(textOf(await admin.page("/websites")), /1 site has changes to check Nu Finish website · Nu Finish Collision Center Changes to check Sent by Dana Groves/);
  assert.match(textOf(await admin.page(`/clients/${clientId}`)), /Website editing Nu Finish website Changes to check/);
  const page = textOf(await admin.page(`/websites/${siteId}`));
  assert.match(page, /Changes to check Sent by Dana Groves, .* New photo: Red truck .* Publish to the site Discard the changes Send back to the client/);

  assert.equal(problemOf(await admin.post(`/websites/${siteId}/send-back`, { note: " " })), "Say what should change.");
  assert.equal(doneOf(await admin.post(`/websites/${siteId}/send-back`, { note: "Say which year the Thanksgiving closure is for." })), "Sent back. The client sees your note in their portal.");
  assert.equal(state(), "editing");
  assert.match(textOf(await dana.page("/portal")), /1 thing is waiting on you Your website changes need another look Say which year the Thanksgiving closure is for\./);
  assert.match(textOf(await dana.page("/portal/website")), /Potomac Solutions asked for a change Say which year the Thanksgiving closure is for\./);
  assert.match(doneOf(await dana.post("/portal/website/notice", { notice: "Closed Thursday and Friday, November 26 and 27." })), /^Saved\./);
  assert.match(doneOf(await dana.post("/portal/website/submit", {})), /^Sent to Potomac Solutions\./);
  assert.equal(state(), "submitted");
});

test("only someone who may publish can; a refusal from GitHub leaves the changes waiting", async () => {
  assert.equal((await member.get(`/websites/${siteId}`)).status, 403);
  assert.equal((await member.get("/websites")).status, 200, "anyone who sees clients sees the list");
  assert.equal(problemOf(await member.post(`/websites/${siteId}/publish`, {})), "You don’t have permission to do that.");
  repo.state.failWith = "repo-refused";
  assert.match(problemOf(await admin.post(`/websites/${siteId}/publish`, {})), /^GitHub refused\./);
  repo.state.failWith = null;
  assert.equal(state(), "submitted");
  assert.equal(repo.commits.length, 0);
});

test("published, the site's repository gets one commit: the content file, the new photo, and the removed photo gone", async () => {
  // Potomac fixes a word before publishing. It stays sent.
  assert.equal(doneOf(await admin.post(`/websites/photos/${photoId("Red truck")}`, { siteId, title: "Red Truck", alt: "A red pickup with its front fender repaired", caption: "Back on the road." })), "Saved.");
  assert.equal(state(), "submitted");
  const truckPath = String(t.db.prepare("select path from content_photo where id = ?").get(photoId("Red Truck"))?.["path"]);

  assert.equal(doneOf(await admin.post(`/websites/${siteId}/publish`, {})), "Published. The site rebuilds with the changes in a minute or two.");
  assert.equal(repo.commits.length, 1);
  const commit = repo.commits[0];
  assert.deepEqual(commit?.wrote, ["src/content/site.json", truckPath]);
  assert.deepEqual(commit?.removed, ["public/gallery/booth.webp"]);
  assert.match(commit?.message ?? "", /^Update site content\n\n- New photo: Red Truck\n- Photo removed: Paint Booth\n/);
  assert.match(commit?.message ?? "", /Published from Potomac HQ\.$/);
  assert.deepEqual(repo.bytes(truckPath), JPEG);
  assert.equal(repo.has("public/gallery/booth.webp"), false);

  const file = JSON.parse(repo.text("src/content/site.json")) as { notice: string; gallery: Record<string, string>[]; testimonials: Record<string, string>[] };
  assert.equal(file.notice, "Closed Thursday and Friday, November 26 and 27.");
  assert.deepEqual(file.gallery.map((photo) => [photo["title"], photo["src"]]), [["Red Truck", `/${truckPath.replace(/^public\//, "")}`], ["Parts", "/gallery/parts.webp"]]);
  assert.ok(file.gallery.every((photo) => /^[0-9a-f-]{36}$/.test(photo["id"] ?? "")), "each photo now carries its id");
  assert.deepEqual(file.testimonials, [{ quote: "They made it easy.", by: "Evelyn S. · via Yelp" }, { quote: "Looks brand new.", by: "Dale P." }]);

  assert.equal(state(), "none");
  assert.equal(count(t.db, "content_photo"), 2, "the removed photo's bytes are gone from HQ too");
  assert.match(textOf(await dana.page("/portal/website")), /This is what’s on your website now .* 1\. Red Truck Back on the road\./);
  assert.doesNotMatch(textOf(await dana.page("/portal/website")), /New Back on the road/, "no longer marked new");
  assert.match(textOf(await admin.page(`/websites/${siteId}`)), /Nothing is waiting .* Last published /);
  const published = events(t.db).find((event) => event.action === "site-content.published");
  assert.equal(published?.actor, mikey);
  assert.equal(published?.context["commit"], "commit1");
  assert.equal(problemOf(await admin.post(`/websites/${siteId}/publish`, {})), "There are no changes waiting.");
});

test("undoing puts things back and drops an unused photo; a change that is undone by hand leaves nothing waiting", async () => {
  assert.match(doneOf(await dana.upload("/portal/website/photos", { title: "Door", alt: "A repaired door" }, { field: "photo", name: "door.jpg", bytes: JPEG })), /^Photo added\./);
  assert.equal(count(t.db, "content_photo"), 3);
  assert.equal(doneOf(await dana.post("/portal/website/discard", {})), "Your changes are undone. Your website is as it was.");
  assert.equal(count(t.db, "content_photo"), 2);
  assert.equal(problemOf(await dana.post("/portal/website/discard", {})), "There are no changes waiting.");
  await dana.post("/portal/website/notice", { notice: "" });
  assert.equal(state(), "editing");
  await dana.post("/portal/website/notice", { notice: "Closed Thursday and Friday, November 26 and 27." });
  assert.equal(state(), "none");
  assert.equal(repo.commits.length, 1);
});

test("the site is read again after a change by hand, but not while changes are waiting", async () => {
  repo.set("src/content/site.json", repo.text("src/content/site.json").replace("Closed Thursday and Friday, November 26 and 27.", "Open again."));
  await dana.post("/portal/website/reviews", { quote: "Fast.", by: "Ann M." });
  assert.equal(problemOf(await admin.post(`/websites/${siteId}/read-again`, {})), "Changes are waiting. Publish or discard them before reading the site again.");
  assert.equal(doneOf(await admin.post(`/websites/${siteId}/discard`, {})), "Changes discarded. The site is as it was.");
  assert.equal(doneOf(await admin.post(`/websites/${siteId}/read-again`, {})), "Read again. This is what is on the site now.");
  assert.match(await dana.page("/portal/website"), /value="Open again\."/);
  assert.equal(count(t.db, "content_photo"), 2);
});
