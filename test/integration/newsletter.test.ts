// The newsletter (decision 0010, slice 2) over real HTTP: signing up from
// HQ's page, the website's form and the website's server; confirming by the
// emailed link; writing, testing and sending an issue a batch at a time;
// leaving by the link or by a mail app's one-click post; and who may do what.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { issueSiteToken } from "../../src/public-site/index.ts";
import { sendDueIssues } from "../../src/newsletter/index.ts";
import { actions, count, httpClient, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

const SITE = "https://potomac.solutions";
type Mail = { to: string; subject: string; body: string; headers?: Readonly<Record<string, string>> };
const mails: Mail[] = [];
let t: TestApp;
let mikey: Client;
let sam: Client;
let token = "";
const query = (res: Response, name: string) => new URL(res.headers.get("location") ?? "", "http://x").searchParams.get(name) ?? "";
const linkIn = (body: string, path: string) => new RegExp(`https://hq\\.example(${path}\\?t=[A-Za-z0-9_-]{43})`).exec(body)?.[1] ?? "";
const tokenOf = (link: string) => new URL(link, "http://x").searchParams.get("t") ?? "";
let visitors = 0;
const fromSite = (body: Record<string, string>, bearer = token) => fetch(`${t.origin}/api/site/newsletter`, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify({ visitor: `203.0.113.${(visitors += 1)}`, ...body }) });
const send = () => sendDueIssues(t.services.newsletter, async (message) => (mails.push(message), true), { publicUrl: "https://hq.example", address: "PO Box 1, Gormania, WV 26720" }, 2);

async function confirm(email: string): Promise<void> {
  const mail = mails.findLast((one) => one.to === email);
  assert.ok(mail, `a confirm email to ${email}`);
  const link = linkIn(mail.body, "/river/confirm");
  const visitor = httpClient(t.origin);
  assert.match(textOf(await visitor.page(link)), /Confirm your subscription/);
  assert.equal(query(await visitor.post("/river/confirm", { t: tokenOf(link) }), "done"), "You’re on the list.");
}

before(async () => {
  t = await testApp({ formOrigins: [SITE], publicUrl: "https://hq.example", contact: { phone: "", email: "", address: "PO Box 1, Gormania, WV 26720" }, email: { publicUrl: "https://hq.example", send: async (message) => (mails.push(message), { ok: true }) } });
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  token = issueSiteToken(t.services.publicSite);
});
after(() => t.stop());

test("signing up on HQ's page emails a confirm link; opening it changes nothing until Confirm is pressed", async () => {
  const visitor = httpClient(t.origin);
  assert.match(await visitor.page("/river?src=stop:lakes"), /<input[^>]*type="hidden"[^>]*name="src"[^>]*value="stop:lakes"/);
  const res = await visitor.post("/river", { email: "Rita@Example.com", name: "Rita", src: "stop:lakes" });
  assert.equal(new URL(res.headers.get("location") ?? "", "http://x").pathname, "/river/check");
  const mail = mails.at(-1);
  assert.equal(mail?.to, "rita@example.com");
  assert.equal(mail?.subject, "Confirm your subscription to Notes from the river");
  const link = linkIn(mail?.body ?? "", "/river/confirm");
  assert.ok(link);
  await visitor.get(link);
  assert.equal(t.db.prepare("select status from newsletter_subscriber").get()?.["status"], "pending", "a mail scanner opening the link signs nobody up");
  await confirm("rita@example.com");
  assert.deepEqual({ ...t.db.prepare("select status, stop, source from newsletter_subscriber").get() }, { status: "subscribed", stop: "lakes", source: "page" });
  assert.match(textOf(await visitor.page(link)), /That link doesn’t work any more/, "a confirm link works once");
});

test("the website's form and the website's server both sign people up; a bad token, a bad email and a bot are turned away", async () => {
  const site = await httpClient(t.origin).post("/river", { email: "dale@example.com", src: "stop:roadside", return_to: `${SITE}/thanks` }, { origin: SITE });
  assert.match(site.headers.get("location") ?? "", /^https:\/\/potomac\.solutions\/thanks\?done=Check%20your%20email/);
  const fromServer = await fromSite({ email: "ann@example.com", name: "Ann", src: "stop:history" });
  assert.deepEqual(await fromServer.json(), { ok: true, status: "check-email", message: "Check your email: we sent a link to confirm. It works for a week." });
  assert.equal((await fromSite({ email: "x@example.com" }, "wrong")).status, 401);
  const bad = await fromSite({ email: "nope" });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { message: string }).message, "Enter your email, like you@example.com.");
  const before = mails.length;
  await httpClient(t.origin).post("/river", { email: "bot@example.com", website: "spam" });
  assert.equal(mails.length, before, "a bot is told it worked and nothing is sent");
  assert.equal(count(t.db, "newsletter_subscriber"), 3);
  await confirm("dale@example.com");
  await confirm("ann@example.com");
});

test("signing up again while on the list sends nothing and says the same thing", async () => {
  const before = mails.length;
  const res = await httpClient(t.origin).post("/river", { email: "rita@example.com" });
  assert.equal(query(res, "done"), "Check your email: we sent a link to confirm. It works for a week.");
  assert.equal(mails.length, before);
});

test("only managers and admins see the list or write issues; the menu offers it only to them", async () => {
  assert.equal((await sam.get("/newsletter")).status, 403);
  assert.equal(query(await sam.post("/newsletter/issues", { subject: "Hi", body: "Hi" }), "problem"), "You don’t have permission to do that.");
  assert.doesNotMatch(await sam.page("/"), /href="\/newsletter"/);
  assert.match(await mikey.page("/"), /href="\/newsletter"/);
  const page = textOf(await mikey.page("/newsletter"));
  assert.match(page, /On the list 3/);
  assert.match(page, /rita@example\.com Rita Lakes and outdoors/);
});

test("an issue is written, tested, sent to its stops a batch at a time, each reader once, with a way out in every email", async () => {
  const made = await mikey.post("/newsletter/issues", { subject: "Winter on the river", body: "Hello from Gormania.", "stop-lakes": "1", "stop-roadside": "1" });
  const issuePath = new URL(made.headers.get("location") ?? "", "http://x").pathname;
  assert.match(issuePath, /^\/newsletter\/issues\/[0-9a-f-]{36}$/);
  assert.match(textOf(await mikey.page(issuePath)), /Goes to: Lakes and outdoors, Roadside businesses ?, 2 readers on the list now/);
  assert.equal(query(await mikey.post(`${issuePath}/test`, {}), "done"), "Test sent to mikey@example.com.");
  assert.equal(mails.at(-1)?.subject, "[Test] Winter on the river");
  assert.equal(query(await mikey.post(`${issuePath}/send`, {}), "done"), "Sending to 2 readers. It goes out in batches over the next few minutes.");
  assert.equal(query(await mikey.post(issuePath, { subject: "Changed", body: "x" }), "problem"), "That issue has already gone out, so it can’t be changed.");
  assert.equal(query(await mikey.post(`${issuePath}/send`, {}), "problem"), "That issue has already gone out, so it can’t be changed.");

  const before = mails.length;
  assert.deepEqual(await send(), { sent: 2, failed: 0 });
  const out = mails.slice(before);
  assert.deepEqual(out.map((one) => one.to).sort(), ["dale@example.com", "rita@example.com"], "only the chosen stops; Ann (history) gets nothing");
  for (const one of out) {
    assert.match(one.body, /^Hello from Gormania\.\n\n—\n/);
    assert.match(one.body, /Unsubscribe with one click: https:\/\/hq\.example\/river\/unsubscribe\?t=/);
    assert.match(one.body, /Potomac Solutions · PO Box 1, Gormania, WV 26720$/);
    assert.match(one.headers?.["List-Unsubscribe"] ?? "", /^<https:\/\/hq\.example\/river\/one-click\?t=[A-Za-z0-9_-]{43}>$/);
    assert.equal(one.headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  }
  assert.deepEqual(await send(), { sent: 0, failed: 0 }, "nobody twice");
  assert.equal(t.db.prepare("select status from newsletter_issue").get()?.["status"], "sent");
  assert.match(textOf(await mikey.page(issuePath)), /2 sent\. To: Lakes and outdoors, Roadside businesses\./);
  assert.ok(actions(t.db).includes("newsletter-issue.finished"));
});

test("leaving by the link in an issue, or a mail app's one-click post, forgets the address", async () => {
  const rita = mails.findLast((one) => one.to === "rita@example.com" && one.subject === "Winter on the river");
  const link = linkIn(rita?.body ?? "", "/river/unsubscribe");
  const visitor = httpClient(t.origin);
  assert.match(textOf(await visitor.page(link)), /Unsubscribe from Notes from the river/);
  assert.equal(query(await visitor.post("/river/unsubscribe", { t: tokenOf(link) }), "done"), "You’re off the list. We won’t email you again.");
  assert.deepEqual({ ...t.db.prepare("select email, name, status from newsletter_subscriber where stop = 'lakes'").get() }, { email: null, name: null, status: "unsubscribed" });

  const dale = mails.findLast((one) => one.to === "dale@example.com" && one.subject === "Winter on the river");
  const oneClick = /<https:\/\/hq\.example(\/river\/one-click\?t=[^>]+)>/.exec(dale?.headers?.["List-Unsubscribe"] ?? "")?.[1] ?? "";
  // A mail app's post: no cookie, no Origin.
  const res = await fetch(`${t.origin}${oneClick}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  assert.equal(res.status, 200);
  assert.equal(t.db.prepare("select status from newsletter_subscriber where stop = 'roadside'").get()?.["status"], "unsubscribed");
  assert.equal((await fetch(`${t.origin}/river/one-click?t=nope`, { method: "POST" })).status, 404);
});

test("someone who left can sign up again, and is a reader once they confirm", async () => {
  await httpClient(t.origin).post("/river", { email: "rita@example.com", src: "stop:enterprise" });
  await confirm("rita@example.com");
  assert.deepEqual({ ...t.db.prepare("select status, email from newsletter_subscriber where email = 'rita@example.com'").get() }, { status: "subscribed", email: "rita@example.com" });
});

test("sending needs the mailing address, and someone in the chosen stops", async () => {
  const bare = await testApp({ publicUrl: "https://hq.example", email: { publicUrl: "https://hq.example", send: async () => ({ ok: true }) } });
  try {
    const admin = await signIn(bare, "mikey@example.com", "Mikey Nichols", ["admin"]);
    await admin.get("/");
    const made = await admin.post("/newsletter/issues", { subject: "Hi", body: "Hi" });
    const issuePath = new URL(made.headers.get("location") ?? "", "http://x").pathname;
    assert.match(query(await admin.post(`${issuePath}/send`, {}), "problem"), /mailing address/);
    assert.match(textOf(await admin.page(issuePath)), /Set HQ_CONTACT_ADDRESS on the server first/);
  } finally {
    await bare.stop();
  }
  const made = await mikey.post("/newsletter/issues", { subject: "Just history", body: "Hi", "stop-mountains": "1" });
  const issuePath = new URL(made.headers.get("location") ?? "", "http://x").pathname;
  assert.equal(query(await mikey.post(`${issuePath}/send`, {}), "problem"), "Nobody on the list is in those stops yet.");
  assert.equal(query(await mikey.post(`${issuePath}/remove`, {}), "done"), "Draft deleted.");
});
