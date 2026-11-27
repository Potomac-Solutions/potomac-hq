// A contact moved to the Trash loses their portal access at that client
// (decision 0022: portal access only where someone is listed as a contact;
// decision 0023: contacts can be deleted). Putting the contact back turns it
// back on. Their access at their other clients isn't touched.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let mikey: Id;

const statusAt = (clientId: string, email: string) => t.services.portal.clientUsers.atClient(clientId as Id, email)?.status ?? null;
const trashIdOf = (recordId: string) => t.db.prepare("select id from trash where record_id = ?").get(recordId)?.["id"] as string;

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: "https://hq.example" });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
});
after(() => t.stop());

test("deleting someone's contact turns off their portal access at that client only, and putting it back turns it on", async () => {
  const towing = unwrap(crm.createClient(t.services.crm, mikey, { name: "Better Days Towing" })).id;
  const adventures = unwrap(crm.createClient(t.services.crm, mikey, { name: "Garrett County Adventures" })).id;
  const contact = unwrap(crm.addContact(t.services.crm, mikey, towing, { name: "Stacy Roberts", email: "stacy@example.com" })).id;
  unwrap(crm.addContact(t.services.crm, mikey, adventures, { name: "Stacy Roberts", email: "stacy@example.com" }));
  const stacy = await clientSignedIn(t, admin, towing, "Stacy Roberts", "stacy@example.com");
  await admin.post(`/clients/${adventures}/portal-users`, { name: "Stacy Roberts", email: "stacy@example.com" });
  assert.match(await stacy.page("/portal"), /Garrett County Adventures/);

  // The page that asks first says what happens to her sign-in.
  const ask = textOf(await admin.page(`/delete?kind=contact&ids=${contact}&back=/clients/${towing}`));
  assert.match(ask, /Goes with it: their portal access here \(turned off\)\./);

  const deleted = await admin.post("/delete", { kind: "contact", ids: contact, back: `/clients/${towing}` });
  assert.equal(deleted.status, 303);
  assert.equal(statusAt(towing, "stacy@example.com"), "disabled");
  assert.equal(statusAt(adventures, "stacy@example.com"), "active", "her other client stays open");
  const portal = textOf(await stacy.page("/portal"));
  assert.match(portal, /Garrett County Adventures/);
  assert.doesNotMatch(portal, /Better Days Towing/);
  assert.match(textOf(await admin.page("/trash")), /With it: their portal access here \(turned off\)\./);

  const back = await admin.post("/trash/restore", { ids: trashIdOf(contact) });
  assert.equal(back.status, 303);
  assert.equal(statusAt(towing, "stacy@example.com"), "active");
  assert.match(await stacy.page("/portal"), /Better Days Towing/);
});

test("someone invited but not signed in yet goes back to invited; another contact with the same email keeps access open", async () => {
  const shop = unwrap(crm.createClient(t.services.crm, mikey, { name: "Nu-Finish Collision" })).id;
  const first = unwrap(crm.addContact(t.services.crm, mikey, shop, { name: "John Groves", email: "grover@example.com" })).id;
  const second = unwrap(crm.addContact(t.services.crm, mikey, shop, { name: "Grover", email: "grover@example.com" })).id;
  const invited = await admin.post(`/clients/${shop}/portal-users`, { name: "John Groves", email: "grover@example.com" });
  assert.equal(invited.status, 200);
  assert.equal(statusAt(shop, "grover@example.com"), "invited");

  // Still listed under the other contact: nothing changes, and the page doesn't say it will.
  assert.doesNotMatch(textOf(await admin.page(`/delete?kind=contact&ids=${first}&back=/clients/${shop}`)), /portal access/);
  await admin.post("/delete", { kind: "contact", ids: first, back: `/clients/${shop}` });
  assert.equal(statusAt(shop, "grover@example.com"), "invited");

  // The last contact with that email goes: the invite is off, and back on with it.
  await admin.post("/delete", { kind: "contact", ids: second, back: `/clients/${shop}` });
  assert.equal(statusAt(shop, "grover@example.com"), "disabled");
  await admin.post("/trash/restore", { ids: trashIdOf(second) });
  assert.equal(statusAt(shop, "grover@example.com"), "invited");
});

test("access turned on again by hand while the contact is in the Trash stays as it was set", async () => {
  const yard = unwrap(crm.createClient(t.services.crm, mikey, { name: "Seven Bolt Salvage" })).id;
  const contact = unwrap(crm.addContact(t.services.crm, mikey, yard, { name: "Rix", email: "rix@example.com" })).id;
  await clientSignedIn(t, admin, yard, "Rix", "rix@example.com");
  await admin.post("/delete", { kind: "contact", ids: contact, back: `/clients/${yard}` });
  assert.equal(statusAt(yard, "rix@example.com"), "disabled");
  const user = t.services.portal.clientUsers.atClient(yard as Id, "rix@example.com");
  await admin.post(`/portal-users/${user?.id}/access`, { on: "1", organizationId: yard });
  assert.equal(statusAt(yard, "rix@example.com"), "active");
  const back = await admin.post("/trash/restore", { ids: trashIdOf(contact) });
  assert.equal(back.status, 303);
  assert.equal(t.db.prepare("select count(*) n from contact where id = ?").get(contact)?.["n"], 1);
  assert.equal(statusAt(yard, "rix@example.com"), "active");
});
