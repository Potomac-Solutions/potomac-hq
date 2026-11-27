// Decision 0022 over real HTTP: one person with portal access at two clients.
// They are given the second only where they are listed as a contact, sign in
// once, see one client at a time, and can switch only between their own.
// Turning their access off at one client leaves the other open.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let mikey: Id;
let towing = { clientId: "", projectId: "" };
let collision = { clientId: "", projectId: "" };
let stacy: Client;

const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const userAt = (clientId: string, email: string) => {
  const found = t.services.portal.clientUsers.atClient(clientId as Id, email);
  assert.ok(found, `${email} at ${clientId}`);
  return found;
};

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: "https://hq.example" });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const one = await wonProject(t.services, mikey, { client: "Better Days Towing", title: "Towing website" });
  const two = await wonProject(t.services, mikey, { client: "Nu-Finish Collision", title: "Collision website" });
  towing = { clientId: one.client.id, projectId: one.project.id };
  collision = { clientId: two.client.id, projectId: two.project.id };
  stacy = await clientSignedIn(t, admin, towing.clientId, "Stacy Roberts", "stacy@example.com");
});
after(() => t.stop());

test("someone in the portal at one client isn't given another unless they are a contact there", async () => {
  const refused = await admin.post(`/clients/${collision.clientId}/portal-users`, { name: "Stacy Roberts", email: "Stacy@Example.com" });
  assert.match(problemOf(refused), /already uses the portal at another client/);
  assert.equal(t.services.portal.clientUsers.atClient(collision.clientId as Id, "stacy@example.com"), null);
  assert.doesNotMatch(await stacy.page("/portal"), /Nu-Finish Collision/);
});

test("listed as a contact, they're given it with the sign-in they have, and see one client at a time", async () => {
  unwrap(crm.addContact(t.services.crm, mikey, collision.clientId as Id, { name: "Stacy Roberts", email: "stacy@example.com" }));
  const added = await admin.post(`/clients/${collision.clientId}/portal-users`, { name: "Stacy Roberts", email: "stacy@example.com" });
  assert.equal(added.status, 303, "no new link to send");
  assert.match(doneOf(added), /already signs in to the portal/);
  assert.equal(userAt(collision.clientId, "stacy@example.com").status, "active");

  // Still at the first client, with a choice of the two.
  const home = await stacy.page("/portal");
  assert.match(home, /<h1>Better Days Towing<\/h1>/);
  assert.match(textOf(home), /Showing/);
  assert.match(home, /Nu-Finish Collision<\/option>/);
  assert.equal((await stacy.get(`/portal/projects/${towing.projectId}`)).status, 200);
  assert.equal((await stacy.get(`/portal/projects/${collision.projectId}`)).status, 404, "the other client's project is not shown at this one");

  // Switched: only the second client's records.
  const switched = await stacy.post("/portal/client", { clientUserId: userAt(collision.clientId, "stacy@example.com").id });
  assert.match(doneOf(switched), /Now showing Nu-Finish Collision/);
  assert.match(await stacy.page("/portal"), /<h1>Nu-Finish Collision<\/h1>/);
  assert.equal((await stacy.get(`/portal/projects/${collision.projectId}`)).status, 200);
  assert.equal((await stacy.get(`/portal/projects/${towing.projectId}`)).status, 404);
  assert.equal(problemOf(await stacy.post(`/portal/projects/${towing.projectId}/messages`, { body: "Wrong client" })), "That record doesn’t exist.");
});

test("they can't switch to a client that isn't theirs", async () => {
  const other = await wonProject(t.services, mikey, { client: "Wolf Armor Coating", title: "Coating website" });
  await clientSignedIn(t, admin, other.client.id, "Carol Wolf", "carol@example.com");
  const tried = await stacy.post("/portal/client", { clientUserId: userAt(other.client.id, "carol@example.com").id });
  assert.match(problemOf(tried), /isn’t one you can see/);
  assert.doesNotMatch(await stacy.page("/portal"), /Wolf Armor Coating/);
  assert.equal((await stacy.get(`/portal/projects/${other.project.id}`)).status, 404);
});

test("turning their access off at one client leaves the other open", async () => {
  const off = await admin.submit(`/portal-users/${userAt(collision.clientId, "stacy@example.com").id}/access`, { on: "0", organizationId: collision.clientId });
  assert.match(off.html, /Access turned off/);
  // The browser still names the client they were at; it's ignored now.
  const home = await stacy.page("/portal");
  assert.match(home, /<h1>Better Days Towing<\/h1>/);
  assert.doesNotMatch(home, /Nu-Finish Collision<\/option>/, "no switcher with one client left");
  assert.equal((await stacy.get(`/portal/projects/${collision.projectId}`)).status, 404);
  assert.match(problemOf(await stacy.post("/portal/client", { clientUserId: userAt(collision.clientId, "stacy@example.com").id })), /isn’t one you can see/);

  // Off at the last one too: signed out everywhere.
  await admin.submit(`/portal-users/${userAt(towing.clientId, "stacy@example.com").id}/access`, { on: "0", organizationId: towing.clientId });
  assert.equal((await stacy.get("/portal")).status, 401);
});
