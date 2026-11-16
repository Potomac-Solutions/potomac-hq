// v1.0: the audit history page, its filters and its CSV.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let manager: Client;
let mikey: Id;

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  manager = await signIn(t, "pat@example.com", "Pat Manager", ["manager"]);
  await manager.get("/");
  const pat = t.db.prepare("select id from user where email = 'pat@example.com'").get()?.["id"] as Id;
  unwrap(crm.createClient(t.services.crm, mikey, { name: "Mt. Storm Bakery" }));
  for (let n = 0; n < 60; n++) unwrap(crm.createClient(t.services.crm, pat, { name: `Client ${n}` }));
});
after(() => t.stop());

test("an admin reads everything, newest first, a page at a time", async () => {
  const page = await admin.page("/activity");
  const total = t.db.prepare("select count(*) as n from activity_event").get()?.["n"] as number;
  assert.match(page, new RegExp(`<h2 id="audit-events">${total} events</h2>`));
  assert.match(textOf(page), /Pat Manager added a client/);
  assert.match(textOf(page), /Page 1 of 2 Older/);
  assert.equal((page.match(/<li>/g) ?? []).length >= 50, true);
  const second = await admin.page("/activity?page=2");
  assert.match(textOf(second), /Newer Page 2 of 2/);
  assert.match(textOf(second), /Mikey Nichols signed in/);
  assert.match(textOf(await admin.page("/activity?page=999")), /Page 2 of 2/, "a page past the end is the last page");
  assert.match(await admin.page("/"), /href="\/activity">See the full history/);
});

test("filters narrow it by person, kind of record, action and day", async () => {
  const mine = textOf(await admin.page(`/activity?actor=${mikey}&recordType=client-organization`));
  assert.match(mine, /1 event /);
  assert.match(mine, /Mikey Nichols added a client/);
  assert.match(mine, /client\.created · client-organization [0-9a-f]{8}/);
  assert.doesNotMatch(mine, /Pat Manager added/);
  assert.match(textOf(await admin.page("/activity?action=user.signed-in")), /1 event Mikey Nichols signed in/);
  assert.match(textOf(await admin.page("/activity?from=2099-01-01")), /0 events Nothing matches/);
  assert.match(textOf(await admin.page(`/activity?to=${t.services.today()}&action=client.`)), /61 events /);
  // Nonsense in the address is ignored.
  assert.match(textOf(await admin.page("/activity?actor=%27%20or%201%3D1&from=yesterday&page=-3")), /Page 1 of 2/);
});

test("the same filters download as a CSV", async () => {
  const res = await admin.get(`/activity.csv?actor=${mikey}&recordType=client-organization`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="hq-audit-\d{4}-\d{2}-\d{2}\.csv"$/);
  const lines = (await res.text()).trim().split("\r\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0] ?? "", /When \(UTC\),Who,Action,Record type,Record,Context$/);
  assert.match(lines[1] ?? "", /,Mikey Nichols,client\.created,client-organization,/);
});

test("only an admin opens it", async () => {
  assert.equal((await manager.get("/activity")).status, 403);
  assert.equal((await manager.get("/activity.csv")).status, 404);
  assert.doesNotMatch(await manager.page("/settings"), /Audit history/);
  assert.match(await admin.page("/settings"), /Audit history/);
  assert.doesNotMatch(await manager.page("/"), /See the full history/);
});
