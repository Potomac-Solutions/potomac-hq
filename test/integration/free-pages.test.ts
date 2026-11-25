// Free landing pages (decision 0010, slice 4) over real HTTP: a client asks
// for theirs, Potomac sets it up, the client sends four free rounds and is
// told before a paid one, approves it and downloads its code; one free page
// a person; rounds wait on Today until marked done; and who may do what.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

const ZIP = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]);
const archived: string[] = [];
let t: TestApp;
let mikey: Client;
let sam: Client;
let rita: Client;
let mikeyId: Id;
let moats: Id;
const query = (res: Response, name: string) => new URL(res.headers.get("location") ?? "", "http://x").searchParams.get(name) ?? "";

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, siteArchive: async (repo) => (archived.push(`${repo.owner}/${repo.name}#${repo.branch}`), ZIP) });
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  moats = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Moats Hardware" })).id;
  unwrap(crm.addContact(t.services.crm, mikeyId, moats, { name: "Rita Moats", email: "rita@example.com", phone: "304-555-0101", isPrimary: true }));
  rita = await clientSignedIn(t, mikey, moats, "Rita Moats", "rita@example.com");
});
after(() => t.stop());

test("the client asks for their free page in the portal; nothing to change until there's something to look at", async () => {
  assert.match(textOf(await rita.page("/portal")), /Your free landing page A one-page website for your business, free for good\. Ask for your free page/);
  assert.equal(query(await rita.post("/portal/landing-page", {}), "done"), "Asked. We’ll be in touch within two business days to get started.");
  assert.equal(query(await rita.post("/portal/landing-page", {}), "problem"), "You’ve already asked for your free landing page.");
  assert.equal(query(await rita.post("/portal/landing-page/rounds", { text: "Bigger logo" }), "problem"), "There’s nothing to look at yet. We’ll let you know when your page is ready.");
  assert.match(textOf(await mikey.page(`/clients/${moats}`)), /Free landing page Asked for/);
});

test("Potomac gives it an address and a repository; a reserved or taken address is refused", async () => {
  assert.equal(query(await mikey.post(`/clients/${moats}/landing-page`, { subdomain: "hq", status: "building", repo: "" }), "problem"), "That name is kept for Potomac’s own use. Choose another.");
  assert.equal(query(await mikey.post(`/clients/${moats}/landing-page`, { subdomain: "Moats Hardware", status: "in-review", repo: "Potomac-Solutions/moats-landing" }), "done"), "Saved.");
  const page = textOf(await mikey.page(`/clients/${moats}/landing-page`));
  assert.match(page, /https:\/\/moats-hardware\.potomac\.solutions/);
  assert.match(page, /0 of 4 free rounds used · 4 left/);
  const other = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Shrout Feed" })).id;
  assert.equal(query(await mikey.post(`/clients/${other}/landing-page`, { subdomain: "moats-hardware", status: "building", repo: "" }), "problem"), "Another client’s page already has that address.");
});

test("four rounds are free; the fifth needs the client to say they know it's paid; each waits on Today until done", async () => {
  for (const n of [1, 2, 3, 4]) assert.equal(query(await rita.post("/portal/landing-page/rounds", { text: `Change ${n}` }), "done"), `Sent. That’s round ${n}. We’ll make the changes and let you know.`);
  const portal = textOf(await rita.page("/portal/landing-page"));
  assert.match(portal, /Rounds of changes: 4 of 4 free rounds used/);
  assert.match(portal, /Your free rounds are used: they’re \$50 an hour/);
  assert.equal(query(await rita.post("/portal/landing-page/rounds", { text: "Change 5" }), "problem"), "Tick the box to say you know these changes are paid.");
  assert.equal(query(await rita.post("/portal/landing-page/rounds", { text: "Change 5", paid: "1" }), "done"), "Sent. We’ll price these changes and check with you before we start.");

  const today = textOf(await mikey.page("/today"));
  assert.match(today, /Round 1 of 4: changes to Moats Hardware’s landing page/);
  assert.match(today, /Paid changes to Moats Hardware’s landing page: price them/);
  const first = t.db.prepare("select id from free_page_round where number = 1").get()?.["id"] as string;
  assert.equal(query(await sam.post(`/landing-page-rounds/${first}/done`, { organizationId: moats }), "done"), "Marked done.", "members do the work too");
  assert.doesNotMatch(textOf(await mikey.page("/today")), /Round 1 of 4/);
  assert.match(textOf(await mikey.page("/landing-pages")), /Moats Hardware https:\/\/moats-hardware\.potomac\.solutions Ready for you to look at 4 of 4 free rounds used 4 waiting/);
});

test("the client approves it, and can then download its code; nobody else's session can", async () => {
  assert.equal((await rita.get("/portal/landing-page.zip")).status, 404, "not before approval");
  assert.equal(query(await rita.post("/portal/landing-page/approve", {}), "done"), "Approved. Thank you! We’ll put it live.");
  assert.equal(query(await rita.post("/portal/landing-page/approve", {}), "problem"), "There’s nothing to look at yet. We’ll let you know when your page is ready.");
  const zip = await rita.get("/portal/landing-page.zip");
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get("content-type"), "application/zip");
  assert.equal(zip.headers.get("content-disposition"), 'attachment; filename="moats-hardware-landing-page.zip"');
  assert.deepEqual(new Uint8Array(await zip.arrayBuffer()), ZIP);
  assert.deepEqual(archived, ["Potomac-Solutions/moats-landing#main"]);
  assert.equal((await mikey.get(`/clients/${moats}/landing-page.zip`)).status, 200);
  assert.match(textOf(await rita.page("/portal/landing-page")), /Your page is approved, so changes from here are paid/);
});

test("one free page a person: a second client with the same email or phone is refused", async () => {
  const again = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Moats Second Store" })).id;
  unwrap(crm.addContact(t.services.crm, mikeyId, again, { name: "Rita M", email: "other@example.com", phone: "(304) 555-0101" }));
  assert.equal(query(await mikey.post(`/clients/${again}/landing-page`, { subdomain: "moats-two", status: "building", repo: "" }), "problem"), "Someone at this client already has a free landing page with another client. It’s one free page a person.");
});

test("members record and see; a signed-out visitor gets nothing", async () => {
  assert.match(textOf(await sam.page(`/clients/${moats}/landing-page`)), /Write down a round asked for by phone or email/);
  assert.equal(query(await sam.post(`/clients/${moats}/landing-page/rounds`, { text: "Called: new hours" }), "done"), "Written down as paid changes. Price them with the client.");
  assert.equal((await fetch(`${t.origin}/clients/${moats}/landing-page.zip`)).status, 404);
  assert.ok(t.db.prepare("select count(*) as n from activity_event where action = 'free-page.approved'").get()?.["n"] === 1);
});
