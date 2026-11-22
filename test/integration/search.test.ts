// Search from the top bar.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import * as finance from "../../src/finance/index.ts";
import * as projects from "../../src/projects/index.ts";
import { readDocuments } from "../../src/knowledge/adapters.ts";
import { seedKnowledge } from "../../src/knowledge/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, httpClient, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
let mikey: Id;
let projectId = "";
let clientId = "";

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const s = t.services;
  const made = await wonProject(s, mikey, { client: "Mt. Storm Bakery", title: "Bakery website" });
  projectId = made.project.id;
  clientId = made.client.id;
  unwrap(crm.addContact(s.crm, mikey, made.client.id, { name: "Ann Baker", email: "ann@mtstormbakery.example", phone: "304-555-0142" } as never));
  unwrap(projects.addTask(s.projects, mikey, made.project.id, { title: "Sourdough photos for the menu page", description: "Ask Ann for the rye loaf too" } as never));
  const invoice = unwrap(finance.createInvoice(s.finance, mikey, made.project.id, { kind: "deposit", description: "Deposit for the bakery", amount: "800" }));
  unwrap(finance.sendInvoiceNow(s.finance, mikey, invoice.id));
  for (let n = 1; n <= 10; n++) unwrap(crm.createClient(s.crm, mikey, { name: `Bakery Number ${n}` }));
  unwrap(crm.createClient(s.crm, mikey, { name: "100% Natural_Foods" }));
  seedKnowledge(s.knowledge, readDocuments(join(import.meta.dirname, "..", "..", "docs")));
  member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
});
after(() => t.stop());

test("one box finds clients, contacts, projects, tasks and invoices, grouped, each going to its page", async () => {
  const html = await admin.page("/search?q=bakery");
  const page = textOf(html);
  assert.match(page, /\d+ matches\. Clients Bakery Number 1 Bakery Number 10 Bakery Number 2/, "names that start with the word first");
  assert.match(page, /Showing the first 8\. Add a word to narrow it down\./);
  assert.match(page, /Projects Bakery website Mt\. Storm Bakery/);
  assert.match(page, /Invoices INV-0001 Mt\. Storm Bakery, Bakery website Sent/);
  assert.match(html, new RegExp(`href="/projects/${projectId}"`));
  assert.match(await admin.page("/search?q=storm"), new RegExp(`href="/clients/${clientId}"`));

  assert.match(textOf(await admin.page("/search?q=storm")), /1 match\. Clients Mt\. Storm Bakery|Clients Mt\. Storm Bakery/);
  assert.match(textOf(await admin.page("/search?q=bakery+mt")), /Clients Mt\. Storm Bakery/, "a better match is never cut off by the limit");
  assert.match(textOf(await admin.page("/search?q=304-555-0142")), /1 match\. Contacts Ann Baker Mt\. Storm Bakery ann@mtstormbakery\.example/);
  assert.match(await admin.page("/search?q=ann%40mtstorm"), new RegExp(`href="/clients/${clientId}#contacts"`));
  assert.match(textOf(await admin.page("/search?q=rye+loaf")), /1 match\. Tasks Sourdough photos for the menu page Bakery website/, "a task's description is searched");
  assert.match(textOf(await admin.page("/search?q=storm+website")), /Projects Bakery website/, "every word must match, in any order");
  assert.match(textOf(await admin.page("/search?q=restore+drill")), /Knowledge base .*Operations/);
});

test("an invoice is found by its number however it is written", async () => {
  for (const q of ["INV-0001", "inv 1", "%231", "invoice 1"]) {
    assert.match(textOf(await admin.page(`/search?q=${q}`)), /Invoices INV-0001 Mt\. Storm Bakery, Bakery website/, q);
  }
});

test("nothing typed can break it, and nothing found says what to try", async () => {
  assert.match(textOf(await admin.page("/search?q=100%25")), /Clients 100% Natural_Foods/, "a % is matched as written");
  assert.doesNotMatch(textOf(await admin.page("/search?q=%25")), /Bakery Number/, "a lone % is not a wildcard");
  assert.match(textOf(await admin.page("/search?q=_")), /Natural_Foods/);
  assert.doesNotMatch(textOf(await admin.page("/search?q=_")), /Bakery Number/, "a _ is not a wildcard");
  for (const q of ["' or 1=1 --", "\") union select * from user --", "<script>alert(1)</script>", "x".repeat(500)]) {
    const res = await admin.get(`/search?q=${encodeURIComponent(q)}`);
    assert.equal(res.status, 200, q);
    const body = await res.text();
    assert.doesNotMatch(body, /<script>alert/, q);
    assert.doesNotMatch(body, /mikey@example\.com.*sam@example\.com/s, q);
  }
  const none = textOf(await admin.page("/search?q=zzqqxx"));
  assert.match(none, /Nothing matches “zzqqxx”\. Check the spelling, or use fewer words\./);
  assert.match(textOf(await admin.page("/search")), /^(?!.*matches).*Search Find a client/s, "an empty box searches nothing");
});

test("each kind is searched only for someone who may see it", async () => {
  const page = textOf(await member.page("/search?q=bakery+website"));
  assert.match(page, /Opportunities Bakery website/);
  assert.match(page, /Projects Bakery website/);
  assert.doesNotMatch(page, /Invoices|INV-0001/, "a member may not see invoices");
  assert.doesNotMatch(textOf(await member.page("/search?q=INV-0001")), /INV-0001 Mt/);

  // A client signed in to the portal gets the HQ sign-in page, and nobody signed out gets anything.
  const ann = await clientSignedIn(t, admin, clientId, "Ann Baker", "ann2@mtstormbakery.example");
  const asClient = await ann.get("/search?q=bakery");
  assert.equal(asClient.status, 401);
  assert.doesNotMatch(await asClient.text(), /Mt\. Storm|INV-/);
  assert.equal((await httpClient(t.origin).get("/search?q=bakery")).status, 401);
});

test("the top bar has the box on every page but the search page itself", async () => {
  const home = await admin.page("/");
  assert.match(home, /<form method="get" action="\/search" role="search" class="hq-find">/);
  assert.match(home, /<label class="sr-only" for="hq-find-q">Search HQ<\/label>/);
  assert.doesNotMatch(await admin.page("/search?q=x"), /class="hq-find"/, "one search box on the search page");
  assert.match(await admin.page("/search?q=bakery+%22mill%22"), /value="bakery &quot;mill&quot;"/, "what was typed is kept in the box, escaped");
});
