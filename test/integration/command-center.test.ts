// Decision 0015 over real HTTP: the hubs in the sidebar, Get HQ ready, and
// (slice 3) the assistant.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { signIn, TEST_PASSWORD_COST, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, backups: true });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
});
after(() => t.stop());

test("the sidebar is hubs, with the one you're in open and its page current", async () => {
  const html = await admin.page("/money/profit");
  const nav = html.slice(html.indexOf('<nav class="hq-nav"'), html.indexOf("</nav>"));
  assert.equal((nav.match(/<details open/g) ?? []).length, 1, "one hub open");
  assert.match(nav, /<details open[^>]*>\s*<summary>(<\?zb[^>]*>)*Money/);
  assert.match(nav, /<a href="\/money" aria-current="page">Money<\/a>/, "Profit and loss sits under Money");
  for (const hub of ["Today", "Clients", "Work", "Sites", "Growth", "Company"]) assert.match(nav, new RegExp(`<summary>(<\\?zb[^>]*>)*${hub}`), hub);
  assert.match(nav, /<a class="hq-hub-one" href="\/"[^>]*>Home<\/a>/);
});

test("a member's hubs leave out what they may not open", async () => {
  const html = await member.page("/");
  const nav = html.slice(html.indexOf('<nav class="hq-nav"'), html.indexOf("</nav>"));
  assert.doesNotMatch(nav, /href="\/money"|href="\/activity"|href="\/settings\/ai"/);
  assert.match(nav, /href="\/projects"/);
});

test("Get HQ ready shows admins what's left, worked out from HQ itself", async () => {
  const before = textOf(await admin.page("/"));
  assert.match(before, /Get HQ ready \d of 8 done/);
  assert.match(before, /Nightly backups : not yet Backups are set up\. This ticks itself once the first one has run tonight\./);
  assert.match(before, /Your co-founder : done/, "Sam makes two");
  assert.match(before, /Your clients : not yet/);

  t.db.prepare("insert into client_organization (id, name, status, created_at, updated_at) values ('00000000-0000-4000-8000-0000000000c1', 'Better Days Towing', 'active', '2026-11-25T00:00:00Z', '2026-11-25T00:00:00Z')").run();
  assert.match(textOf(await admin.page("/")), /Your clients : done/);

  assert.doesNotMatch(textOf(await member.page("/")), /Get HQ ready/, "admins only");
});
