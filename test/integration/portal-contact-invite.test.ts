// Inviting a client's contact to the portal from their row on the client's
// page, and the Portal column showing where each contact stands.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let clientId = "";

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: "https://hq.example" });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  clientId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Better Days Towing", sizeTier: "small" })).id;
  unwrap(crm.addContact(t.services.crm, mikey, clientId as Id, { name: "Stacy Roberts", email: "Stacy@BetterDays.example", isPrimary: true }));
  unwrap(crm.addContact(t.services.crm, mikey, clientId as Id, { name: "Phone Only", phone: "301-555-0100" }));
});
after(() => t.stop());

test("a contact with an email gets an invite button, and their status once invited", async () => {
  const first = await admin.page(`/clients/${clientId}`);
  assert.match(first, /aria-label="Invite to the portal: Stacy Roberts"/);
  assert.match(first, /name="email" value="stacy@betterdays\.example"/);
  assert.doesNotMatch(first, /aria-label="Invite to the portal: Phone Only"/);
  assert.match(textOf(first), /Add an email to invite/);

  // The button sends the contact's own name and email to the usual invite.
  const invited = await admin.post(`/clients/${clientId}/portal-users`, { name: "Stacy Roberts", email: "stacy@betterdays.example" });
  assert.equal(invited.status, 200);
  assert.match(await invited.text(), /Send this link to Stacy Roberts/);

  const then = await admin.page(`/clients/${clientId}`);
  assert.doesNotMatch(then, /aria-label="Invite to the portal: Stacy Roberts"/);
  const row = /<tr>(?:(?!<\/tr>)[\s\S])*Stacy Roberts(?:(?!<\/tr>)[\s\S])*<\/tr>/.exec(then)?.[0] ?? "";
  assert.match(textOf(`<body>${row}`), /Invited, not signed in yet/);
});

