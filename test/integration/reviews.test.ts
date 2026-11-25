// Reviews and case studies (decision 0013, slice 7) over real HTTP: a
// client is asked by email and writes a review from the link, once; another
// writes one in the portal; only one that may be shown is published; a case
// study with screenshots is written and published; the website reads only
// what is published, with its token; and who may do what.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import { issueSiteToken } from "../../src/public-site/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { httpClient, PASSWORD, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const sent: { to: string; subject: string; body: string }[] = [];
let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let moats: Id;
let token = "";
const query = (res: Response, name: string) => new URL(res.headers.get("location") ?? "", "http://x").searchParams.get(name) ?? "";
const site = (path: string, bearer = token) => fetch(`${t.origin}${path}`, { headers: { authorization: `Bearer ${bearer}` } });

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: "https://hq.example", email: { publicUrl: "https://hq.example", send: async (message) => (sent.push({ to: message.to, subject: message.subject, body: message.body }), { ok: true }) } });
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  moats = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Moats Hardware" })).id;
  unwrap(crm.addContact(t.services.crm, mikeyId, moats, { name: "Rita Moats", email: "rita@example.com", isPrimary: true }));
  token = issueSiteToken(t.services.publicSite);
});
after(() => t.stop());

test("asking emails the contact a link; the review is written from it once, and waits to be published", async () => {
  assert.equal(query(await mikey.post(`/clients/${moats}/review-request`, {}), "done"), "Asked. The link went to rita@example.com; it works for 30 days.");
  const mail = sent.at(-1);
  assert.equal(mail?.subject, "Would you write a few words about working with us?");
  const link = /https:\/\/hq\.example(\/review\?t=[A-Za-z0-9_-]{43})/.exec(mail?.body ?? "")?.[1] ?? "";
  const t1 = new URL(link, "http://x").searchParams.get("t") ?? "";
  const visitor = httpClient(t.origin);
  assert.match(textOf(await visitor.page(link)), /How did we do\?/);
  assert.equal(query(await visitor.post("/review", { t: t1, rating: "9", text: "x", displayName: "x" }), "problem"), "Choose from 1 to 5 stars.");
  const done = await visitor.post("/review", { t: t1, rating: "5", text: "They built our site in a week and it brings in calls.", displayName: "Rita M.", town: "Gormania", mayPublish: "1" });
  assert.equal(query(done, "done"), "Thank you! It means a lot to a small business like ours.");
  assert.match(textOf(await visitor.page(link)), /That link doesn’t work any more/, "the link works once");
  assert.match(textOf(await mikey.page("/today")), /A review from Moats Hardware to publish/);
});

test("a review its writer said not to show can't be published; one that may be shown can", async () => {
  const shrout = (await wonProject(t.services, mikeyId, { client: "Shrout Feed" })).client.id;
  await mikey.post(`/clients/${shrout}/portal-users`, { name: "Wes Shrout", email: "wes@example.com" });
  const invite = /\/portal\/accept\?token=([A-Za-z0-9_-]{43})/.exec(sent.findLast((one) => one.to === "wes@example.com")?.body ?? "")?.[1] ?? "";
  const wes = httpClient(t.origin);
  await wes.post("/portal/accept", { token: invite, name: "Wes Shrout", password: PASSWORD });
  assert.match(textOf(await wes.page("/portal")), /How did we do\? .* Write a review/);
  assert.equal(query(await wes.post("/portal/review", { rating: "4", text: "Good work, a bit slow.", displayName: "Wes" }), "done"), "Thank you for your review! It means a lot to a small business like ours.");
  assert.equal(query(await wes.post("/portal/review", { rating: "5", text: "Again", displayName: "Wes" }), "problem"), "You’ve already written a review. Thank you!");
  assert.doesNotMatch(textOf(await wes.page("/portal")), /Write a review/);
  const wesReview = t.db.prepare("select id from review where display_name = 'Wes'").get()?.["id"] as string;
  assert.equal(query(await mikey.post(`/reviews/${wesReview}/publish`, {}), "problem"), "The writer didn’t say it may be shown, so it can’t be published.");
  const rita = t.db.prepare("select id from review where display_name = 'Rita M.'").get()?.["id"] as string;
  assert.equal(query(await mikey.post(`/reviews/${rita}/publish`, {}), "done"), "Published. The website shows it from its next check.");
  assert.equal(query(await mikey.post(`/reviews/${wesReview}/hide`, {}), "done"), "Kept back. It isn’t shown anywhere.");
  const page = textOf(await mikey.page("/reviews"));
  assert.match(page, /On the website ★★★★★ Moats Hardware “They built our site in a week/);
  assert.match(page, /Kept back ★★★★☆ Shrout Feed: “Good work, a bit slow\.” Wes · Not to be shown/);
});

test("a case study with screenshots is written, and published when ticked", async () => {
  assert.equal(query(await mikey.post(`/clients/${moats}/case-study`, { headline: "", position: "1" }), "problem"), "Give the case study a headline.");
  assert.equal(query(await mikey.post(`/clients/${moats}/case-study`, { headline: "A hardware store found online", problem: "Nobody could find their hours.", built: "A one-page site.", result: "More calls.", liveUrl: "https://moats.com", position: "1" }), "done"), "Saved as a draft.");
  const study = t.db.prepare("select id from case_study").get()?.["id"] as string;
  const added = await mikey.upload(`/case-studies/${study}/shots`, { alt: "The home page on a phone", organizationId: moats }, { field: "shot", name: "home.png", bytes: PNG, type: "image/png" });
  assert.equal(query(added, "done"), "Screenshot added.");
  const bad = await mikey.upload(`/case-studies/${study}/shots`, { alt: "Not a picture", organizationId: moats }, { field: "shot", name: "x.png", bytes: new TextEncoder().encode("<svg onload=alert(1)>"), type: "image/png" });
  assert.equal(query(bad, "problem"), "That isn’t a JPEG, PNG or WebP picture.");
  const shot = t.db.prepare("select id from case_study_shot").get()?.["id"] as string;
  const picture = await mikey.get(`/case-study-shots/${shot}`);
  assert.equal(picture.headers.get("content-type"), "image/png");
  assert.equal((await sam.get(`/case-study-shots/${shot}`)).status, 404);

  // A draft isn't on the website.
  let shown = (await (await site("/api/site/showcase")).json()) as { caseStudies: unknown[]; reviews: { name: string }[] };
  assert.deepEqual(shown.caseStudies, []);
  assert.equal((await site(`/api/site/showcase/files/${shot}`)).status, 404);
  await mikey.post(`/clients/${moats}/case-study`, { headline: "A hardware store found online", problem: "Nobody could find their hours.", built: "A one-page site.", result: "More calls.", liveUrl: "https://moats.com", position: "1", published: "1" });
  shown = (await (await site("/api/site/showcase")).json()) as typeof shown;
  assert.deepEqual(shown.reviews.map((one) => one.name), ["Rita M."], "only the published review");
  assert.deepEqual(shown.caseStudies, [{ id: study, client: "Moats Hardware", headline: "A hardware store found online", problem: "Nobody could find their hours.", built: "A one-page site.", result: "More calls.", url: "https://moats.com", shots: [{ path: `/api/site/showcase/files/${shot}`, alt: "The home page on a phone" }] }]);
  const file = await site(`/api/site/showcase/files/${shot}`);
  assert.equal(file.status, 200);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), PNG);
  assert.equal((await site("/api/site/showcase", "wrong")).status, 401);
});

test("members can't ask, publish or write case studies", async () => {
  assert.equal((await sam.get("/reviews")).status, 403);
  assert.equal(query(await sam.post(`/clients/${moats}/review-request`, {}), "problem"), "You don’t have permission to do that.");
  assert.equal(query(await sam.post(`/clients/${moats}/case-study`, { headline: "Mine" }), "problem"), "You don’t have permission to do that.");
  assert.doesNotMatch(await sam.page(`/clients/${moats}`), /Open reviews and case study/);
});
