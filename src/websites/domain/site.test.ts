import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import type { SiteContent } from "./content.ts";
import { cleanRepo, discarded, publishedAs, repoPathFor, sentBack, siteSetup, srcFor, submitted, withDraft, working, type ContentSite } from "./site.ts";

const live: SiteContent = { notice: "", gallery: [{ id: "0190a000-0000-7000-8000-000000000001" as Id, src: "/gallery/a.webp", alt: "A", title: "A", caption: "", extra: {} }], reviews: [], extra: {} };
const changed: SiteContent = { ...live, notice: "Closed Friday." };
const site: ContentSite = { id: "0190a000-0000-7000-8000-00000000000a" as Id, organizationId: "0190a000-0000-7000-8000-00000000000b" as Id, name: "Nu Finish website", repo: { owner: "Potomac-Solutions", name: "nu-finish-site", branch: "main" }, contentPath: "src/content/site.json", photoDir: "public/gallery", published: live, publishedAt: null, publishedCommit: null, draft: null, draftState: "none", submittedAt: null, submittedBy: null, note: "", siteUrl: "", launch: { mode: "live", opensAt: null, message: "" }, previewKey: null };

test("a repository is owner/name, or its address on GitHub", () => {
  assert.deepEqual(cleanRepo("Potomac-Solutions/nu-finish-site"), { ok: true, value: { owner: "Potomac-Solutions", name: "nu-finish-site" } });
  assert.deepEqual(cleanRepo(" https://github.com/Potomac-Solutions/nu-finish-site.git/ "), { ok: true, value: { owner: "Potomac-Solutions", name: "nu-finish-site" } });
  for (const bad of ["", "nu-finish-site", "a/b/c", "-bad/repo", "owner/..", "owner/re po", "https://gitlab.com/a/b", "owner/repo?x=1"]) assert.equal(cleanRepo(bad).ok, false, bad);
});

test("setting a site up fills in the usual places, and refuses a path that leaves the repository", () => {
  assert.deepEqual(siteSetup({ name: " Nu Finish website ", repo: "Potomac-Solutions/nu-finish-site" }), { ok: true, value: { name: "Nu Finish website", repo: { owner: "Potomac-Solutions", name: "nu-finish-site", branch: "main" }, contentPath: "src/content/site.json", photoDir: "public/gallery", siteUrl: "" } });
  const base = { name: "Site", repo: "a/b" };
  assert.deepEqual(siteSetup({ ...base, name: "" }), { ok: false, error: "name-missing" });
  assert.deepEqual(siteSetup({ ...base, repo: "nope" }), { ok: false, error: "repo-invalid" });
  for (const branch of ["a..b", "-x", "feat//x", "x.lock", "a b"]) assert.deepEqual(siteSetup({ ...base, branch }), { ok: false, error: "branch-invalid" }, branch);
  for (const contentPath of ["../site.json", "src/content/site.txt", "src//site.json", ".github/x.json"]) assert.deepEqual(siteSetup({ ...base, contentPath }), { ok: false, error: "content-path-invalid" }, contentPath);
  assert.deepEqual(siteSetup({ ...base, photoDir: "public/../.." }), { ok: false, error: "photo-dir-invalid" });
  assert.deepEqual(siteSetup({ ...base, branch: "development", photoDir: "/static/img/" }).ok && siteSetup({ ...base, branch: "development", photoDir: "/static/img/" }), { ok: true, value: { name: "Site", repo: { owner: "a", name: "b", branch: "development" }, contentPath: "src/content/site.json", photoDir: "static/img", siteUrl: "" } });
  assert.deepEqual(siteSetup({ ...base, siteUrl: "http://plain.example" }), { ok: false, error: "address-invalid" });
  assert.equal(siteSetup({ ...base, siteUrl: "nufinishcollision.com" }).ok && "ok", "ok");
});

test("a photo's address on the site and its place in the repository are told apart by the public folder", () => {
  assert.equal(srcFor("public/gallery", "hq-1.jpg"), "/gallery/hq-1.jpg");
  assert.equal(srcFor("public", "hq-1.jpg"), "/hq-1.jpg");
  assert.equal(srcFor("static/img", "hq-1.jpg"), "/static/img/hq-1.jpg");
  assert.equal(repoPathFor("public/gallery", "/gallery/booth.webp"), "public/gallery/booth.webp");
  assert.equal(repoPathFor("public/gallery", "/images/old.jpg"), "public/images/old.jpg");
  assert.equal(repoPathFor("static/img", "/static/img/x.png"), "static/img/x.png");
});

test("a client's change waits as 'editing'; sent, it is 'submitted'; a further change by them takes it back", () => {
  const editing = withDraft(site, changed, "client");
  assert.equal(editing.draftState, "editing");
  assert.equal(working(editing).notice, "Closed Friday.");
  assert.equal(working(site).notice, "");
  assert.deepEqual(submitted(site, "Dana", "2026-11-23T20:00:00Z"), { ok: false, error: "nothing-to-send" });
  const sent = submitted(editing, "Dana Groves", "2026-11-23T20:00:00Z");
  assert.ok(sent.ok);
  assert.deepEqual([sent.value.draftState, sent.value.submittedBy, sent.value.submittedAt], ["submitted", "Dana Groves", "2026-11-23T20:00:00Z"]);
  assert.deepEqual(submitted(sent.value, "Dana", "2026-11-23T20:01:00Z"), { ok: false, error: "already-sent" });
  const more = withDraft(sent.value, { ...changed, notice: "Closed Friday and Saturday." }, "client");
  assert.deepEqual([more.draftState, more.submittedAt], ["editing", null]);
  const fixed = withDraft(sent.value, { ...changed, notice: "Closed Friday" }, "staff");
  assert.equal(fixed.draftState, "submitted", "Potomac's own fix leaves it sent");
});

test("a change that puts things back as they are on the site leaves nothing waiting", () => {
  const back = withDraft(withDraft(site, changed, "client"), live, "client");
  assert.deepEqual([back.draft, back.draftState], [null, "none"]);
});

test("sent back needs a note and something sent; discarded and published leave nothing waiting", () => {
  const editing = withDraft(site, changed, "client");
  assert.deepEqual(sentBack(editing, "Fix it"), { ok: false, error: "not-sent" });
  const sent = submitted(editing, "Dana", "2026-11-23T20:00:00Z");
  assert.ok(sent.ok);
  assert.deepEqual(sentBack(sent.value, " "), { ok: false, error: "note-missing" });
  const returned = sentBack(sent.value, " Say which Friday. ");
  assert.ok(returned.ok);
  assert.deepEqual([returned.value.draftState, returned.value.note, returned.value.submittedAt], ["editing", "Say which Friday.", null]);
  const again = submitted(returned.value, "Dana", "2026-11-23T21:00:00Z");
  assert.ok(again.ok);
  assert.equal(again.value.note, "", "sending again clears the note");
  assert.deepEqual(discarded(site), { ok: false, error: "nothing-waiting" });
  const dropped = discarded(sent.value);
  assert.ok(dropped.ok);
  assert.deepEqual([dropped.value.draft, dropped.value.draftState, dropped.value.published.notice], [null, "none", ""]);
  const done = publishedAs(sent.value, "abc123", "2026-11-23T22:00:00Z");
  assert.deepEqual([done.published.notice, done.draft, done.draftState, done.publishedCommit, done.publishedAt, done.submittedBy], ["Closed Friday.", null, "none", "abc123", "2026-11-23T22:00:00Z", null]);
});
