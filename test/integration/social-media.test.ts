// Social media over real HTTP (decision 0011): a plan on a client, the
// month's drafts, sending them, the client approving in the portal and
// asking for a change, approval after three days of quiet, Today, and
// marking a post up. A client sees only their own.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, addUser, clientSignedIn, signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";
import { approveQuietPosts, setPlan, writePost } from "../../src/social/index.ts";

let t: TestApp;
let admin: Client;
let farm: Client;
let farmId: Id;
let dinerId: Id;
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const today = () => Temporal.Now.plainDateISO("America/New_York");
const month = () => today().toString().slice(0, 7);
const idOf = (words: string) => t.db.prepare("select id from social_post where words = ?").get(words)?.["id"] as string;
const statusOf = (words: string) => ({ ...(t.db.prepare("select status, approved_by from social_post where words = ?").get(words) as { status: string; approved_by: string | null }) });

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  farmId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Bayard Farm Stand", sizeTier: "small" })).id;
  dinerId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Route 50 Diner", sizeTier: "small" })).id;
  farm = await clientSignedIn(t, admin, farmId, "Pat Farmer", "pat@example.com");
});
after(() => t.stop());

test("a plan is set on the client's page, then shown there and on Social media", async () => {
  assert.match(textOf(await admin.page(`/clients/${farmId}`)), /Social media No plan\./);
  assert.equal(problemOf(await admin.post(`/clients/${farmId}/social/plan`, { postsPerMonth: "8", blogsPerMonth: "1" })), "Tick at least one network.");
  assert.equal(problemOf(await admin.post(`/clients/${farmId}/social/posts`, { kind: "post", day: today().toString(), "network-facebook": "1", words: "Too soon" })), "Set the client’s social media plan first.");
  const saved = await admin.post(`/clients/${farmId}/social/plan`, { "network-facebook": "1", "page-facebook": "facebook.com/bayardfarm", "network-instagram": "1", postsPerMonth: "8", blogsPerMonth: "1", about: "Friendly. Never mention prices." });
  assert.equal(doneOf(saved), "Plan saved.");
  const page = textOf(await admin.page(`/clients/${farmId}/social`));
  assert.match(page, /Facebook and Instagram, 8 posts and 1 blog post a month/);
  assert.match(page, /0 of 8 posts, 0 of 1 blog post/);
  assert.match(textOf(await admin.page(`/clients/${farmId}`)), /Facebook and Instagram, 8 posts and 1 blog post a month\. This month: 0 of 8 posts, 0 of 1 blog post\./);
  assert.match(textOf(await admin.page("/social")), /Bayard Farm Stand Still to write Facebook and Instagram/);
  assert.ok(actions(t.db).includes("social-plan.set"));
});

test("drafts are checked against the plan; an Instagram post needs its picture before sending", async () => {
  const day = today().toString();
  assert.equal(problemOf(await admin.post(`/clients/${farmId}/social/posts`, { kind: "post", day, "network-linkedin": "1", words: "Hi" })), "A post can only go to the plan’s networks. Add the network to the plan first.");
  assert.equal(problemOf(await admin.post(`/clients/${farmId}/social/posts`, { kind: "post", day, "network-instagram": "1", words: "x".repeat(2201) })), "Instagram takes up to 2,200 characters. Shorten it, or don’t send it to Instagram.");
  assert.equal(doneOf(await admin.post(`/clients/${farmId}/social/posts`, { kind: "post", day, "network-facebook": "1", "network-instagram": "1", words: "Sweet corn is in." })), "Post added as a draft.");
  assert.equal(doneOf(await admin.post(`/clients/${farmId}/social/posts`, { kind: "post", day, "network-facebook": "1", words: "Open Saturday." })), "Post added as a draft.");
  assert.equal(doneOf(await admin.post(`/clients/${farmId}/social/posts`, { kind: "blog", day, title: "Why we grow heirlooms", words: "Because they taste like summer." })), "Blog post added as a draft.");
  assert.match(textOf(await admin.page(`/clients/${farmId}/social`)), /2 of 8 posts, 1 of 1 blog post/);
  assert.equal(problemOf(await admin.post(`/clients/${farmId}/social/send`, { month: month() })), "An Instagram post needs its picture. Say what it shows on each Instagram post before sending.");
  assert.equal(statusOf("Sweet corn is in.").status, "draft", "nothing was sent");
  const id = idOf("Sweet corn is in.");
  assert.match(doneOf(await admin.post(`/social/posts/${id}`, { clientId: farmId, month: month(), day, "network-facebook": "1", "network-instagram": "1", words: "Sweet corn is in.", picture: "Corn in a crate by the stand" })), /^Saved as a draft/);
  assert.equal(doneOf(await admin.post(`/clients/${farmId}/social/send`, { month: month() })), "Sent 3 to the client. It’s in their portal, and counts as approved in 3 days if they say nothing.");
});

test("the client sees the month in the portal, asks for one change and approves the rest", async () => {
  const home = textOf(await farm.page("/portal"));
  assert.match(home, /Approve your posts for .* 3 posts to look over\. If we don’t hear from you by .*, we’ll go ahead\./);
  const page = textOf(await farm.page("/portal/social"));
  assert.match(page, /3 posts are waiting on you\./);
  assert.match(page, /Sweet corn is in\./);
  assert.equal(doneOf(await farm.post(`/portal/social/posts/${idOf("Open Saturday.")}/changes`, { month: month(), note: "Say 8 to noon" })), "Sent. We’ll change it and send it back to you.");
  assert.equal(doneOf(await farm.post("/portal/social/approve", { month: month() })), "Thank you. We’ll put them up on their days.");
  assert.deepEqual(statusOf("Sweet corn is in."), { status: "approved", approved_by: "client" });
  assert.equal(statusOf("Open Saturday.").status, "changes");
  assert.match(textOf(await admin.page(`/clients/${farmId}/social`)), /The client asked: Say 8 to noon/);
  assert.match(textOf(await admin.page("/today")), /Bayard Farm Stand asked for a change to a post .* Put up a post on Facebook and Instagram/);
});

test("a client can't see or answer another client's posts, nor reach HQ's pages", async () => {
  const diner = unwrap(setPlan(t.services.social, t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id, dinerId, { networks: ["facebook"], pages: {}, postsPerMonth: "4", blogsPerMonth: "0" }));
  assert.ok(diner);
  const post = unwrap(writePost(t.services.social, t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id, dinerId, { kind: "post", day: today().toString(), networks: ["facebook"], words: "Pie Friday" }));
  await admin.post(`/clients/${dinerId}/social/send`, { month: month() });
  assert.equal(problemOf(await farm.post(`/portal/social/posts/${post.id}/changes`, { month: month(), note: "mine now" })), "That doesn’t exist.");
  assert.doesNotMatch(textOf(await farm.page("/portal/social")), /Pie Friday/);
  assert.equal(statusOf("Pie Friday").status, "sent");
  const hq = await farm.get(`/clients/${dinerId}/social`);
  assert.notEqual(hq.status, 200);
});

test("a post the client didn't answer is approved after three days, and marked up from HQ", async () => {
  // Move the diner's sent post back three days, then run the hourly job.
  t.db.prepare("update social_post set sent_at = ? where words = 'Pie Friday'").run(Temporal.Now.instant().subtract({ hours: 73 }).toString());
  assert.equal(approveQuietPosts(t.services.social), 1);
  assert.deepEqual(statusOf("Pie Friday"), { status: "approved", approved_by: "auto" });
  assert.match(textOf(await admin.page(`/clients/${dinerId}/social`)), /Approved: no changes asked in 3 days/);
  const id = idOf("Sweet corn is in.");
  assert.equal(problemOf(await admin.post(`/social/posts/${id}/posted`, { clientId: farmId, month: month(), "link-facebook": "not a link" })), "Enter the link as a web address, like feedstore.com/winter.");
  assert.equal(doneOf(await admin.post(`/social/posts/${id}/posted`, { clientId: farmId, month: month(), "link-facebook": "facebook.com/bayardfarm/posts/1" })), "Marked up.");
  assert.equal(statusOf("Sweet corn is in.").status, "posted");
  assert.match(textOf(await farm.page("/portal/social")), /See it on Facebook: https:\/\/facebook\.com\/bayardfarm\/posts\/1/);
  assert.ok(actions(t.db).includes("social-post.posted"));
});

test("a member can work the calendar; a disabled permission refuses", async () => {
  const member = addUser(t.db, "member", "Sam Member");
  assert.equal(unwrap(writePost(t.services.social, member, farmId, { kind: "post", day: today().toString(), networks: ["facebook"], words: "From Sam" })).status, "draft");
  const nobody = addUser(t.db, null, "No Roles");
  assert.deepEqual(writePost(t.services.social, nobody, farmId, { kind: "post", day: today().toString(), networks: ["facebook"], words: "Nope" }), { ok: false, error: "forbidden" });
  assert.deepEqual(setPlan(t.services.social, nobody, farmId, { networks: ["facebook"], pages: {}, postsPerMonth: "1", blogsPerMonth: "0" }), { ok: false, error: "forbidden" });
});
