// Client QR codes over real HTTP (decision 0024): a client makes codes in the
// portal for their own site, downloads them, and sees what their site's
// script reported; Potomac's people see the same and the script. A report
// counts only from that client's own site, for that client's code, once in
// 30 minutes, and never from a program.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actions, clientSignedIn, count, httpClient, signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";

let t: TestApp;
let admin: Client;
let member: Client;
let towing: Client;
let feed: Client;
let towingId: Id;
let feedId: Id;
const SITE = "https://betterdaystowing.com";
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const codeId = (code: string, organizationId: Id = towingId) => t.db.prepare("select id from site_qr_code where code = ? and organization_id = ?").get(code, organizationId)?.["id"] as string;
/** What the script on a site sends. Each report comes from its own network address unless one is given. */
let visitor = 0;
const report = (given: Record<string, string>, options: { origin?: string; agent?: string; from?: string } = {}) => {
  const fields = { v: `visit${++visitor}`, ...given };
  return (
  fetch(`${t.origin}/hooks/site-qr`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: options.origin ?? SITE, "user-agent": options.agent ?? PHONE, "x-forwarded-for": options.from ?? `203.0.113.${++visitor}` },
    body: new URLSearchParams(fields).toString(),
  }));
};

before(async () => {
  t = await testApp({ publicUrl: "https://hq.example", proxies: 1 });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  member = await signIn(t, "sam@example.com", "Sam Teter", ["member"]);
  await member.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  towingId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Better Days Towing", sizeTier: "small" })).id;
  feedId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Gormania Feed", sizeTier: "small" })).id;
  towing = await clientSignedIn(t, admin, towingId, "Stacy Roberts", "stacy@example.com");
  feed = await clientSignedIn(t, admin, feedId, "Ann Moats", "ann@example.com");
});
after(() => t.stop());

test("with no website address, a client is told to ask for one, and no code can be made", async () => {
  assert.match(textOf(await towing.page("/portal/qr-codes")), /We don’t have your website’s address yet/);
  assert.equal(problemOf(await towing.post("/portal/qr-codes", { label: "Cards", page: "/", code: "card" })), "We don’t have your website’s address yet. Ask us to add it, then make a code.");
});

test("a client makes codes for their own site in the portal; the page is theirs and the code is printed", async () => {
  assert.equal((await admin.post(`/clients/${towingId}/sites`, { url: "betterdaystowing.com" })).status, 303);
  assert.equal((await admin.post(`/clients/${feedId}/sites`, { url: "gormaniafeed.com" })).status, 303);
  assert.match(textOf(await towing.page("/portal")), /QR codes for your cards and flyers .* Make a QR code/);
  assert.equal(problemOf(await towing.post("/portal/qr-codes", { label: "", page: "/", code: "card" })), "Say what the code is printed on, like Business cards.");
  assert.equal(problemOf(await towing.post("/portal/qr-codes", { label: "Cards", page: "https://gormaniafeed.com/", code: "card" })), "Enter a page on your website, like / for the home page or /services.");
  assert.equal(doneOf(await towing.post("/portal/qr-codes", { label: "Business cards, spring 2027", page: "/", code: "Card" })), "QR code made. Download it for your cards or flyers.");
  assert.equal(problemOf(await towing.post("/portal/qr-codes", { label: "More cards", page: "/", code: "card" })), "Another of your QR codes already uses that code. Choose a different one.");
  assert.equal(doneOf(await towing.post("/portal/qr-codes", { label: "Flyer at the diner", page: "/towing?area=garrett", code: "" })), "QR code made. Download it for your cards or flyers.");
  // Another client may use the same code on their own site.
  assert.equal(doneOf(await feed.post("/portal/qr-codes", { label: "Feed store cards", page: "/", code: "card" })), "QR code made. Download it for your cards or flyers.");
  const page = textOf(await towing.page("/portal/qr-codes"));
  assert.match(page, /Business cards, spring 2027 https:\/\/betterdaystowing\.com\/\?ref=card 0 scans 0 in the last 30 days Not scanned yet/);
  assert.match(page, /Flyer at the diner https:\/\/betterdaystowing\.com\/towing\?area=garrett&ref=[a-z2-9]{6} /);
  assert.doesNotMatch(page, /Feed store cards/);
  assert.doesNotMatch(page, /The script for their website/, "the script is for Potomac's people");
  const made = actions(t.db).filter((one) => one === "site-qr.created");
  assert.equal(made.length, 3);
});

test("the picture downloads as SVG or PNG, for its own client only", async () => {
  const png = await towing.get(`/portal/qr-codes/${codeId("card")}/qr.png?download=1`);
  assert.equal(png.status, 200);
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.equal(png.headers.get("content-disposition"), 'attachment; filename="qr-card.png"');
  assert.deepEqual([...new Uint8Array(await png.arrayBuffer()).subarray(1, 4)], [0x50, 0x4e, 0x47]);
  const svg = await towing.get(`/portal/qr-codes/${codeId("card")}/qr.svg`);
  assert.match(await svg.text(), /QR code for Business cards, spring 2027/);
  assert.equal((await feed.get(`/portal/qr-codes/${codeId("card")}/qr.svg`)).status, 404, "another client's code");
  assert.equal((await httpClient(t.origin).get(`/portal/qr-codes/${codeId("card")}/qr.svg`)).status, 404, "signed out");
  assert.equal((await admin.get(`/site-qr/${codeId("card")}/qr.png`)).status, 200);
});

test("a scan from the client's own site is counted, once in 30 minutes; anything else is not", async () => {
  const counted = await report({ code: "card", kind: "scan", t: String(Date.now()) });
  assert.equal(counted.status, 204);
  assert.equal(counted.headers.get("access-control-allow-origin"), "*");
  assert.equal((await report({ code: "CARD", kind: "scan" }, { origin: "https://www.betterdaystowing.com" })).status, 204);
  // The same visit again, a program, another client's site, a site nobody has, an odd kind, a code nobody made: all answered the same, none counted.
  assert.equal((await report({ code: "card", kind: "scan", v: "samevisit" })).status, 204);
  assert.equal((await report({ code: "card", kind: "scan", v: "samevisit" })).status, 204);
  // Two phones behind one mobile network's address are two people.
  await report({ code: "card", kind: "scan" }, { from: "198.51.100.7" });
  await report({ code: "card", kind: "scan" }, { from: "198.51.100.7" });
  await report({ code: "card", kind: "scan" }, { agent: "facebookexternalhit/1.1" });
  await report({ code: "card", kind: "scan" }, { origin: "https://evil.example" });
  await report({ code: "card", kind: "scan" }, { origin: "" });
  await report({ code: "card", kind: "visit" });
  await report({ code: "made-up", kind: "scan" });
  assert.equal(count(t.db, "site_qr_event"), 5);
  // The feed store's "card" is its own: a report from its site counts for it, not for the towing company.
  await report({ code: "card", kind: "scan" }, { origin: "https://gormaniafeed.com" });
  assert.equal(t.db.prepare("select count(*) as n from site_qr_event where code_id = ?").get(codeId("card", feedId))?.["n"], 1);
  // A tap after the scan, and a scan kept in the browser for two days while HQ was down.
  await report({ code: "card", kind: "call" });
  await report({ code: "card", kind: "scan", t: String(Date.now() - 2 * 24 * 3600 * 1000) });
  const columns = (t.db.prepare("select name from pragma_table_info('site_qr_event')").all() as { name: string }[]).map((one) => one.name);
  assert.deepEqual(columns, ["code_id", "kind", "happened_at", "received_at"], "a report keeps what and when, and nothing about the person");
  const page = textOf(await towing.page("/portal/qr-codes"));
  assert.match(page, /6 scans, 6 in the last 30 days 1 person tapped to call, text or email after scanning\./);
  assert.match(page, /Business cards, spring 2027 https:\/\/betterdaystowing\.com\/\?ref=card 6 scans 6 in the last 30 days 1 call Last scanned/);
  assert.equal(actions(t.db).filter((one) => one.startsWith("site-qr.") && one !== "site-qr.created").length, 0, "a scan writes no event");
});

test("a report that isn't a small form is refused", async () => {
  const json = await fetch(`${t.origin}/hooks/site-qr`, { method: "POST", headers: { "content-type": "application/json", origin: SITE, "user-agent": PHONE }, body: JSON.stringify({ code: "card", kind: "scan" }) });
  assert.equal(json.status, 400);
  const big = await fetch(`${t.origin}/hooks/site-qr`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: SITE, "user-agent": PHONE }, body: `code=card&kind=scan&pad=${"x".repeat(600)}` });
  assert.equal(big.status, 413);
  assert.equal((await fetch(`${t.origin}/hooks/site-qr`, { method: "OPTIONS", headers: { origin: SITE } })).status, 204);
});

test("a scanned code can't be removed, only retired and brought back; an unscanned one can go", async () => {
  assert.match(problemOf(await towing.post(`/portal/qr-codes/${codeId("card")}/remove`, {})), /^That code has been scanned/);
  assert.equal(doneOf(await towing.post(`/portal/qr-codes/${codeId("card")}/retire`, {})), "Retired. It still counts if someone scans an old card.");
  assert.match(textOf(await towing.page("/portal/qr-codes")), /Retired Still counted if someone scans an old card\. Business cards, spring 2027 6 scans/);
  await report({ code: "card", kind: "scan" });
  assert.equal(t.db.prepare("select count(*) as n from site_qr_event where code_id = ? and kind = 'scan'").get(codeId("card"))?.["n"], 7, "a retired code still counts");
  assert.equal(doneOf(await towing.post(`/portal/qr-codes/${codeId("card")}/restore`, {})), "Brought back.");
  assert.equal(doneOf(await towing.post(`/portal/qr-codes/${codeId("card")}/rename`, { label: "Business cards, 2027" })), "Saved.");
  const flyer = t.db.prepare("select id from site_qr_code where organization_id = ? and label = 'Flyer at the diner'").get(towingId)?.["id"] as string;
  assert.equal(problemOf(await feed.post(`/portal/qr-codes/${flyer}/remove`, {})), "That doesn’t exist.", "another client's code");
  assert.equal(doneOf(await towing.post(`/portal/qr-codes/${flyer}/remove`, {})), "Removed.");
  assert.deepEqual(actions(t.db).filter((one) => /^site-qr\.(retired|restored|renamed|removed)$/.test(one)), ["site-qr.retired", "site-qr.restored", "site-qr.renamed", "site-qr.removed"]);
});

test("Potomac's people see the client's codes with the script, and when HQ last heard from the site", async () => {
  assert.match(textOf(await admin.page(`/clients/${towingId}`)), /QR codes 1 code ?, 7 scans/);
  const page = await admin.page(`/clients/${towingId}/qr-codes`);
  assert.match(textOf(page), /The script for their website HQ last heard from their site /);
  assert.match(page, /https:\/\/hq\.example\/hooks\/site-qr/);
  assert.equal(doneOf(await member.post(`/clients/${towingId}/qr-codes`, { label: "Truck door decal", page: "/", code: "truck" })), "QR code made. Download it, or send the client to their portal for it.");
  assert.equal(doneOf(await member.post(`/site-qr/${codeId("truck")}/rename`, { label: "Truck decal" })), "Saved.");
  assert.match(textOf(await towing.page("/portal/qr-codes")), /Truck decal https:\/\/betterdaystowing\.com\/\?ref=truck/);
});
