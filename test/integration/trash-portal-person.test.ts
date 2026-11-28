// Deleting one of a client's portal people (decision 0023, amended
// 2026-11-28): admins only, from the client's Client portal panel. They go
// to the Trash with what they sent from the portal, and can be put back for
// 30 days. Their access at their other clients isn't touched.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let mikey: Id;

const one = (sql: string, ...args: string[]) => t.db.prepare(sql).get(...args) as Record<string, unknown> | undefined;
const count = (sql: string, ...args: string[]) => Number(one(sql, ...args)?.["n"] ?? 0);
const portalPersonAt = (clientId: string, email: string) => t.services.portal.clientUsers.atClient(clientId as Id, email);

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: "https://hq.example" });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
});
after(() => t.stop());

test("an admin deletes a portal person: what they sent goes with them, their other client stays, and it all comes back", async () => {
  const won = await wonProject(t.services, mikey, { client: "Better Days Towing", title: "Website rebuild" });
  const towing = won.client.id;
  const adventures = unwrap(crm.createClient(t.services.crm, mikey, { name: "Garrett County Adventures" })).id;
  unwrap(crm.addContact(t.services.crm, mikey, adventures, { name: "Stacy Roberts", email: "stacy@example.com" }));
  const stacy = await clientSignedIn(t, admin, towing, "Stacy Roberts", "stacy@example.com");
  await admin.post(`/clients/${adventures}/portal-users`, { name: "Stacy Roberts", email: "stacy@example.com" });
  await stacy.post("/portal/requests", { title: "Change our Saturday hours", details: "", projectId: won.project.id });
  await stacy.post(`/portal/projects/${won.project.id}/messages`, { body: "Looks great so far." });
  const person = portalPersonAt(towing, "stacy@example.com");
  assert.ok(person);
  assert.equal(count("select count(*) as n from client_request where client_user_id = ?", person.id), 1);
  assert.equal(count("select count(*) as n from project_update where client_user_id = ?", person.id), 1);
  const taskId = one("select task_id from client_request where client_user_id = ?", person.id)?.["task_id"] as string;

  // The client page offers it beside her, under Client portal.
  const page = await admin.page(`/clients/${towing}`);
  assert.match(page, new RegExp(`href="/delete\\?kind=portal-person&ids=${person.id}&back=/clients/${towing}%23portal"`));

  // The page that asks first says what goes.
  const ask = textOf(await admin.page(`/delete?kind=portal-person&ids=${person.id}&back=/clients/${towing}`));
  assert.match(ask, /Delete this portal person\?/);
  assert.match(ask, /Stacy Roberts/);
  assert.match(ask, /1 message/);
  assert.match(ask, /1 request/);

  const deleted = await admin.post("/delete", { kind: "portal-person", ids: person.id, back: `/clients/${towing}#portal` });
  assert.equal(deleted.status, 303);
  assert.equal(portalPersonAt(towing, "stacy@example.com"), null);
  assert.equal(count("select count(*) as n from client_request where client_user_id = ?", person.id), 0);
  assert.equal(count("select count(*) as n from project_update where client_user_id = ?", person.id), 0);
  assert.ok(one("select id from task where id = ?", taskId), "the task her request made stays");
  assert.doesNotMatch(textOf(await admin.page(`/clients/${towing}`)), /stacy@example\.com/);

  // Signed in, she now sees only her other client.
  const portal = textOf(await stacy.page("/portal"));
  assert.match(portal, /Garrett County Adventures/);
  assert.doesNotMatch(portal, /Better Days Towing/);
  assert.equal(portalPersonAt(adventures, "stacy@example.com")?.status !== undefined, true);

  assert.match(textOf(await admin.page("/trash")), /Stacy Roberts[\s\S]*Portal person[\s\S]*Better Days Towing[\s\S]*With it: 1 message and 1 request/);
  const trashId = one("select id from trash where record_id = ?", person.id)?.["id"] as string;
  assert.equal((await admin.post("/trash/restore", { ids: trashId })).status, 303);
  assert.equal(portalPersonAt(towing, "stacy@example.com")?.id, person.id);
  assert.equal(count("select count(*) as n from client_request where client_user_id = ?", person.id), 1);
  assert.equal(count("select count(*) as n from project_update where client_user_id = ?", person.id), 1);
  assert.match(textOf(await stacy.page("/portal")), /Better Days Towing/);
});

test("only an admin may delete a portal person", async () => {
  const shop = unwrap(crm.createClient(t.services.crm, mikey, { name: "Nu-Finish Collision" })).id;
  await clientSignedIn(t, admin, shop, "John Groves", "grover@example.com");
  const person = portalPersonAt(shop, "grover@example.com");
  assert.ok(person);
  const manager = await signIn(t, "jo@example.com", "Jo Manager", ["manager"]);
  await manager.get("/");
  assert.doesNotMatch(await manager.page(`/clients/${shop}`), /kind=portal-person/);
  assert.equal((await manager.get(`/delete?kind=portal-person&ids=${person.id}`)).status, 403);
  await manager.post("/delete", { kind: "portal-person", ids: person.id });
  assert.ok(portalPersonAt(shop, "grover@example.com"), "still there");
});
