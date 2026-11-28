import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalIsDue, approved, approvesBy, changesAsked, dueToPost, editPost, monthCount, newPost, pictured, posted, readMonth, readPlan, SHOWN_TO_CLIENT, sent, shiftMonth, skipped, type SocialPlan } from "./social.ts";
import type { Id } from "../../shared/domain/id.ts";

const org = "22222222-2222-4222-8222-222222222222" as Id;
const planIds = { id: "11111111-1111-4111-8111-111111111111" as Id, organizationId: org };
const postIds = { id: "33333333-3333-4333-8333-333333333333" as Id, organizationId: org };
const fileId = "44444444-4444-4444-8444-444444444444" as Id;

function plan(networks = ["facebook", "instagram"]): SocialPlan {
  const made = readPlan(planIds, { networks, pages: { facebook: "facebook.com/feedstore" }, postsPerMonth: "8", blogsPerMonth: "1", about: " Friendly, local. " });
  assert.ok(made.ok);
  return made.value;
}

test("a plan needs a network, checks page addresses and counts, and keeps NETWORKS order", () => {
  const made = readPlan(planIds, { networks: ["linkedin", "facebook"], pages: { facebook: "facebook.com/feedstore", linkedin: "" }, postsPerMonth: "8", blogsPerMonth: "1" });
  assert.ok(made.ok);
  assert.deepEqual(made.value.pages, [{ network: "facebook", pageUrl: "https://facebook.com/feedstore" }, { network: "linkedin", pageUrl: "" }]);
  assert.equal(plan().about, "Friendly, local.");
  const base = { pages: {}, postsPerMonth: "8", blogsPerMonth: "1" };
  assert.deepEqual(readPlan(planIds, { ...base, networks: [] }), { ok: false, error: "no-networks" });
  assert.deepEqual(readPlan(planIds, { ...base, networks: ["tiktok"] }), { ok: false, error: "invalid-network" });
  assert.deepEqual(readPlan(planIds, { ...base, networks: ["facebook"], pages: { facebook: "not a page" } }), { ok: false, error: "invalid-page" });
  assert.deepEqual(readPlan(planIds, { ...base, networks: ["facebook"], postsPerMonth: "eight" }), { ok: false, error: "invalid-count" });
  assert.deepEqual(readPlan(planIds, { ...base, networks: ["facebook"], postsPerMonth: "0", blogsPerMonth: "0" }), { ok: false, error: "invalid-count" });
  assert.deepEqual(readPlan(planIds, { ...base, networks: ["facebook"], about: "x".repeat(2001) }), { ok: false, error: "about-too-long" });
});

test("a post goes only to the plan's networks, within each network's limit", () => {
  const p = plan();
  const made = newPost(postIds, p, { kind: "post", day: "2026-12-04", networks: ["instagram", "facebook"], words: " Fresh feed in. ", link: "feedstore.com", picture: "Bags on the porch" });
  assert.ok(made.ok);
  assert.deepEqual([made.value.networks, made.value.words, made.value.link, made.value.status], [["facebook", "instagram"], "Fresh feed in.", "https://feedstore.com/", "draft"]);
  const at = (input: Partial<Parameters<typeof newPost>[2]>) => newPost(postIds, p, { kind: "post", day: "2026-12-04", networks: ["facebook"], words: "Hi", ...input });
  assert.deepEqual(at({ networks: ["linkedin"] }), { ok: false, error: "network-not-in-plan" });
  assert.deepEqual(at({ networks: [] }), { ok: false, error: "no-networks" });
  assert.deepEqual(at({ words: " " }), { ok: false, error: "words-missing" });
  assert.deepEqual(at({ networks: ["instagram"], words: "x".repeat(2201) }), { ok: false, error: "instagram-too-long" });
  assert.equal(at({ words: "x".repeat(3000) }).ok, true);
  assert.deepEqual(at({ words: "x".repeat(3001) }), { ok: false, error: "words-too-long" });
  assert.deepEqual(at({ day: "2026-02-30" }), { ok: false, error: "invalid-date" });
  assert.deepEqual(at({ link: "nope" }), { ok: false, error: "invalid-link" });
});

test("a blog post needs a title and goes to no network", () => {
  const made = newPost(postIds, plan(), { kind: "blog", day: "2026-12-10", networks: ["facebook"], title: "Winter feed", words: "x".repeat(20000) });
  assert.ok(made.ok);
  assert.deepEqual(made.value.networks, []);
  assert.deepEqual(newPost(postIds, plan(), { kind: "blog", day: "2026-12-10", words: "x" }), { ok: false, error: "title-missing" });
  assert.deepEqual(newPost(postIds, plan(), { kind: "video", day: "2026-12-10", words: "x" }), { ok: false, error: "invalid-kind" });
});

test("sent, asked to change, edited, sent again, approved, posted", () => {
  const p = plan();
  const draft = newPost(postIds, p, { kind: "post", day: "2026-12-04", networks: ["instagram"], words: "Hi" });
  assert.ok(draft.ok);
  assert.deepEqual(sent(draft.value, "2026-12-01T12:00:00Z"), { ok: false, error: "instagram-needs-picture" });
  const edited = editPost(draft.value, p, { kind: "post", day: "2026-12-04", networks: ["instagram"], words: "Hi", picture: "The barn" });
  assert.ok(edited.ok);
  assert.deepEqual(sent(edited.value, "2026-12-01T12:00:00Z"), { ok: false, error: "instagram-needs-picture" });
  const withPicture = pictured(edited.value, fileId);
  assert.ok(withPicture.ok);
  const out = sent(withPicture.value, "2026-12-01T12:00:00Z");
  assert.ok(out.ok);
  assert.equal(out.value.status, "sent");
  assert.deepEqual(sent(out.value, "2026-12-01T12:00:00Z"), { ok: false, error: "nothing-to-send" });
  const asked = changesAsked(out.value, " Say Saturday too ");
  assert.ok(asked.ok);
  assert.deepEqual([asked.value.status, asked.value.clientNote], ["changes", "Say Saturday too"]);
  const fixed = editPost(asked.value, p, { kind: "post", day: "2026-12-04", networks: ["instagram"], words: "Hi, open Saturday", picture: "The barn" });
  assert.ok(fixed.ok);
  assert.deepEqual([fixed.value.status, fixed.value.clientNote], ["draft", "Say Saturday too"]);
  assert.equal(fixed.value.pictureFileId, fileId, "an edit keeps the picture");
  const again = sent(fixed.value, "2026-12-02T12:00:00Z");
  assert.ok(again.ok);
  assert.equal(again.value.clientNote, "");
  assert.deepEqual(posted(again.value, {}, "2026-12-04T12:00:00Z"), { ok: false, error: "not-approved" });
  const yes = approved(again.value, "client", "2026-12-02T13:00:00Z");
  assert.ok(yes.ok);
  assert.deepEqual(changesAsked(yes.value, "late"), { ok: false, error: "not-sent" });
  const up = posted(yes.value, { instagram: "instagram.com/p/abc", facebook: "ignored.com" }, "2026-12-04T15:00:00Z");
  assert.ok(up.ok);
  assert.deepEqual([up.value.status, up.value.postedLinks], ["posted", { instagram: "https://instagram.com/p/abc" }]);
  assert.deepEqual(editPost(up.value, p, { kind: "post", day: "2026-12-04", networks: ["facebook"], words: "x" }), { ok: false, error: "already-up" });
  assert.deepEqual(skipped(up.value, "why"), { ok: false, error: "already-up" });
});

test("editing an approved post sends it back to a draft", () => {
  const p = plan();
  const draft = newPost(postIds, p, { kind: "post", day: "2026-12-04", networks: ["facebook"], words: "Hi" });
  assert.ok(draft.ok);
  const out = sent(draft.value, "2026-12-01T12:00:00Z");
  assert.ok(out.ok);
  const yes = approved(out.value, "staff", "2026-12-01T13:00:00Z", "By text");
  assert.ok(yes.ok);
  assert.deepEqual([yes.value.approvedBy, yes.value.approvalNote], ["staff", "By text"]);
  assert.deepEqual(approved(out.value, "staff", "2026-12-01T13:00:00Z", " "), { ok: false, error: "note-missing" });
  const edited = editPost(yes.value, p, { kind: "post", day: "2026-12-05", networks: ["facebook"], words: "Hello" });
  assert.ok(edited.ok);
  assert.deepEqual([edited.value.status, edited.value.approvedBy, edited.value.day], ["draft", null, "2026-12-05"]);
});

test("a sent post counts as approved after three days of quiet", () => {
  const draft = newPost(postIds, plan(), { kind: "post", day: "2026-12-04", networks: ["facebook"], words: "Hi" });
  assert.ok(draft.ok);
  const out = sent(draft.value, "2026-12-01T12:00:00Z");
  assert.ok(out.ok);
  assert.equal(approvesBy(out.value), "2026-12-04T12:00:00Z");
  assert.equal(approvalIsDue(out.value, "2026-12-04T11:59:59Z"), false);
  assert.equal(approvalIsDue(out.value, "2026-12-04T12:00:00Z"), true);
  assert.equal(approvalIsDue(draft.value, "2027-01-01T00:00:00Z"), false);
});

test("the month's count against the plan, over it, and what's due", () => {
  const p = plan();
  const posts = [...Array.from({ length: 9 }, () => ({ kind: "post" as const, status: "draft" as const })), { kind: "post" as const, status: "skipped" as const }];
  assert.deepEqual(monthCount(p, posts), { posts: 9, blogs: 0, planPosts: 8, planBlogs: 1, text: "9 of 8 posts, 0 of 1 blog post", over: "1 post more than the plan" });
  assert.equal(monthCount({ postsPerMonth: 1, blogsPerMonth: 0 }, []).text, "0 of 1 post");
  assert.equal(dueToPost({ status: "approved", day: "2026-12-04" }, "2026-12-04"), true);
  assert.equal(dueToPost({ status: "approved", day: "2026-12-05" }, "2026-12-04"), false);
  assert.equal(dueToPost({ status: "sent", day: "2026-12-01" }, "2026-12-04"), false);
  assert.equal(readMonth("2026-13", "2026-11-25"), "2026-11");
  assert.equal(readMonth("2027-01", "2026-11-25"), "2027-01");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
});

test("a picture is attached to a draft, kept through edits, and taken off; a post that's up keeps its picture", () => {
  const p = plan();
  const draft = newPost(postIds, p, { kind: "post", day: "2026-12-04", networks: ["instagram"], words: "Hi" });
  assert.ok(draft.ok);
  assert.equal(draft.value.pictureFileId, null);
  const attached = pictured(draft.value, fileId);
  assert.ok(attached.ok);
  assert.equal(attached.value.pictureFileId, fileId);
  const edited = editPost(attached.value, p, { kind: "post", day: "2026-12-04", networks: ["instagram"], words: "Hi again" });
  assert.ok(edited.ok);
  assert.equal(edited.value.pictureFileId, fileId);
  const taken = pictured(edited.value, null);
  assert.ok(taken.ok);
  assert.deepEqual([taken.value.pictureFileId, taken.value.status], [null, "draft"]);
  assert.deepEqual(pictured({ ...draft.value, status: "posted" }, fileId), { ok: false, error: "already-up" });
  assert.deepEqual(pictured({ ...draft.value, status: "skipped" }, null), { ok: false, error: "already-up" });
  assert.ok(SHOWN_TO_CLIENT.includes("sent") && SHOWN_TO_CLIENT.includes("posted"));
  assert.equal(SHOWN_TO_CLIENT.includes("draft"), false);
  assert.equal(SHOWN_TO_CLIENT.includes("skipped"), false);
});
