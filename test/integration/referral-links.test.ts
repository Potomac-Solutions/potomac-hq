// Referral links over real HTTP: a manager makes one, its QR code is a
// picture of its short address, a scan is counted and sent on with the
// code, a preview is not counted, and an inquiry that carries the code is
// credited to the link.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actions, count, httpClient, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
const SITE = "https://potomac.solutions";
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const problemOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("done") ?? "";
const linkId = (code: string) => t.db.prepare("select id from referral_link where code = ?").get(code)?.["id"] as string;
const scan = (code: string, agent = PHONE) => fetch(`${t.origin}/r/${code}`, { redirect: "manual", headers: { "user-agent": agent } });

before(async () => {
  t = await testApp({ formOrigins: [SITE], publicUrl: "https://hq.example" });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  member = await signIn(t, "sam@example.com", "Sam Teter", ["member"]);
  await member.get("/");
});
after(() => t.stop());

test("a link is made with a code of its own or one HQ makes up; a taken or odd code is refused", async () => {
  assert.match(textOf(await admin.page("/referrals")), /Referral links .* No referral links yet/);
  assert.equal(problemOf(await admin.post("/referrals", { label: "", destination: SITE, code: "card" })), "Say what the link is printed on, like Business cards.");
  assert.equal(problemOf(await admin.post("/referrals", { label: "Cards", destination: "http://potomac.solutions", code: "card" })), "Enter where a scan should go: an https address like potomac.solutions, or a page here like /contact.");
  assert.match(problemOf(await admin.post("/referrals", { label: "Cards", destination: SITE, code: "my card" })), /^A code is 2 to 32 lower-case letters/);
  assert.equal(doneOf(await admin.post("/referrals", { label: "Business cards, winter 2026", destination: "potomac.solutions", code: "Card" })), "Link made. Print its QR code, or copy its address.");
  assert.equal(problemOf(await admin.post("/referrals", { label: "More cards", destination: SITE, code: "card" })), "Another link already uses that code. Choose a different one.");
  assert.equal(doneOf(await admin.post("/referrals", { label: "Flyer at the feed store", destination: "/contact", code: "" })), "Link made. Print its QR code, or copy its address.");
  const made = t.db.prepare("select code, destination from referral_link order by created_at").all() as { code: string; destination: string }[];
  assert.equal(made[0]?.code, "card");
  assert.equal(made[0]?.destination, "https://potomac.solutions/");
  assert.match(made[1]?.code ?? "", /^[a-z2-9]{6}$/);
  const page = textOf(await admin.page("/referrals"));
  assert.match(page, /Business cards, winter 2026 https:\/\/hq\.example\/r\/card Goes to https:\/\/potomac\.solutions\/ No scans yet/);
  assert.ok(actions(t.db).includes("referral-link.created"));
});

test("only managers and admins see or make links, and the menu offers it only to them", async () => {
  assert.equal((await member.get("/referrals")).status, 403);
  assert.equal(problemOf(await member.post("/referrals", { label: "Mine", destination: SITE, code: "mine" })), "You don’t have permission to do that.");
  assert.equal((await member.get(`/referrals/${linkId("card")}/qr.svg`)).status, 404);
  assert.doesNotMatch(await member.page("/"), /href="\/referrals"/);
  assert.match(await admin.page("/"), /href="\/referrals"/);
});

test("the QR code is a picture, to show or to download", async () => {
  const shown = await admin.get(`/referrals/${linkId("card")}/qr.svg`);
  assert.equal(shown.status, 200);
  assert.equal(shown.headers.get("content-type"), "image/svg+xml");
  assert.equal(shown.headers.get("content-disposition"), null);
  assert.match(await shown.text(), /^<svg [^>]*aria-label="QR code for Business cards, winter 2026"/);
  const saved = await admin.get(`/referrals/${linkId("card")}/qr.svg?download=1`);
  assert.equal(saved.headers.get("content-disposition"), 'attachment; filename="qr-card.svg"');
  assert.equal((await httpClient(t.origin).get(`/referrals/${linkId("card")}/qr.svg`)).status, 404, "signed out");
});

test("a scan is sent on with the code and counted; a preview or a HEAD is sent on and not counted", async () => {
  const first = await scan("card");
  assert.equal(first.status, 302);
  assert.equal(first.headers.get("location"), "https://potomac.solutions/?ref=card");
  assert.equal(first.headers.get("cache-control"), "no-store");
  await scan("CARD");
  assert.equal((await scan("card", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)")).status, 302);
  assert.equal((await fetch(`${t.origin}/r/card`, { method: "HEAD", redirect: "manual", headers: { "user-agent": PHONE } })).status, 302);
  assert.equal(count(t.db, "referral_scan"), 2);
  assert.equal((await scan("nothing-here")).status, 404);
  assert.equal((await scan("..%2f")).status, 404);
  const columns = (t.db.prepare("select name from pragma_table_info('referral_scan')").all() as { name: string }[]).map((one) => one.name);
  assert.deepEqual(columns, ["link_id", "scanned_at"], "a scan keeps a time and nothing about the person");
  assert.match(textOf(await admin.page("/referrals")), /0 of 2 scans led to an inquiry \(0%\) 2 in the last 30 days · last scanned/);
});

test("an inquiry that carries the code is credited to the link, from HQ's own form or the website's", async () => {
  const visitor = httpClient(t.origin);
  assert.match(await visitor.page("/contact?ref=card"), /<input[^>]*type="hidden"[^>]*name="ref"[^>]*value="card"/);
  assert.doesNotMatch(await visitor.page("/contact"), /name="ref"/);
  assert.doesNotMatch(await visitor.page("/contact?ref=%22%3E%3Cscript%3E"), /name="ref"/);
  assert.equal((await visitor.post("/contact", { name: "Rita Okafor", email: "rita@example.com", message: "Saw your card at the diner. Need a menu page.", ref: "card" })).status, 303);
  const fromSite = await httpClient(t.origin).post("/contact", { name: "Dale Pruitt", email: "dale@example.com", message: "Farm stand website", ref: "card", return_to: `${SITE}/thanks` }, { origin: SITE });
  assert.match(fromSite.headers.get("location") ?? "", /^https:\/\/potomac\.solutions\/thanks\?done=Thanks/);
  // A code nobody made, and no code at all: the inquiry is still saved, and credited to nothing.
  assert.equal((await httpClient(t.origin).post("/contact", { name: "Ann Moats", email: "ann@example.com", message: "A question", ref: "made-up" })).status, 303);
  assert.equal((await httpClient(t.origin).post("/contact", { name: "Bo Shrout", email: "bo@example.com", message: "Another question" })).status, 303);
  assert.equal(count(t.db, "opportunity"), 4);
  assert.equal(count(t.db, "referral_inquiry"), 2);
  const page = textOf(await admin.page("/referrals"));
  assert.match(page, /2 scans, 2 inquiries/);
  assert.match(page, /2 of 2 scans led to an inquiry \(100%\)/);
  assert.match(page, /Inquiry: Saw your card at the diner/);
  assert.ok(actions(t.db).includes("referral-link.inquiry"));
});

test("a link's label and destination change, its code does not; a scanned link is not removed, an unscanned one is", async () => {
  assert.equal(doneOf(await admin.post(`/referrals/${linkId("card")}`, { label: "Business cards", destination: "/book" })), "Saved. Scans go to the new address from now on.");
  assert.equal((await scan("card")).headers.get("location"), "/book?ref=card");
  assert.equal(problemOf(await admin.post(`/referrals/${linkId("card")}/remove`, {})), "That link has been scanned, so it stays. Printed codes may still be out there.");
  const other = t.db.prepare("select id from referral_link where code <> 'card'").get()?.["id"] as string;
  assert.equal(doneOf(await admin.post(`/referrals/${other}/remove`, {})), "Removed.");
  assert.equal(count(t.db, "referral_link"), 1);
});
