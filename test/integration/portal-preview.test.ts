// Viewing a client person's portal from HQ (decision 0020): an admin or
// manager sees exactly what the client sees, changes nothing, and the client
// is not told. Every start and stop is in the activity log.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, clientSignedIn, count, PDF, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
let ann: Client;
let mikey: Id;
let clientId: Id;
let otherClientId: Id;
let annId: Id;
let fileId: Id;

const idOf = (email: string) => t.db.prepare("select id from client_user where email = ?").get(email)?.["id"] as Id;

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  member = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const won = await wonProject(t.services, mikey, { client: "Mt. Storm Bakery", title: "Bakery website" });
  clientId = won.client.id;
  const shared = unwrap(projects.addDeliverable(t.services.projects, mikey, won.project.id, { title: "Home page design", file: { name: "design.pdf", bytes: PDF } }));
  unwrap(projects.setDeliverableShared(t.services.projects, mikey, shared.id, true));
  fileId = shared.fileId;
  ann = await clientSignedIn(t, admin, clientId, "Ann Baker", "ann@bakery.example");
  annId = idOf("ann@bakery.example");
  otherClientId = (await wonProject(t.services, mikey, { client: "Gormania Feed", title: "Feed store site" })).client.id;
});
after(() => t.stop());

test("an admin sees a client person's portal as they do, and HQ says so on every page", async () => {
  assert.match(textOf(await admin.page(`/clients/${clientId}`)), /View their portal/);
  assert.doesNotMatch(textOf(await member.page(`/clients/${clientId}`)), /View their portal/, "a member may not manage the portal");

  const started = await admin.post("/portal-preview", { clientUserId: annId });
  assert.equal(started.status, 303);
  assert.equal(started.headers.get("location"), "/portal");

  const home = textOf(await admin.page("/portal"));
  assert.match(home, /You’re viewing Ann Baker’s portal at Mt\. Storm Bakery, as they see it\. Nothing can be changed, and they aren’t told\./);
  assert.match(home, /Mt\. Storm Bakery/);
  assert.match(home, /Bakery website/);
  assert.doesNotMatch(home, /Gormania|Feed store/, "only that client's records");
  assert.doesNotMatch(home, /Sign out/, "the client's sign-out isn't offered");

  assert.match(textOf(await admin.page("/")), /You’re viewing Ann Baker’s portal at Mt\. Storm Bakery\./, "HQ's own pages say so too");
});

test("nothing can be changed while viewing, in the portal or in HQ, and opening a file is logged as the admin's", async () => {
  const before = { updates: count(t.db, "project_update"), calls: count(t.db, "call_request") };
  const project = t.db.prepare("select id from project where organization_id = ?").get(clientId)?.["id"] as Id;
  for (const [path, fields] of [
    [`/portal/projects/${project}/messages`, { body: "Sent by someone else" }],
    ["/portal/calls", { wanted: "soon", note: "", phone: "" }],
    ["/portal/sign-out", {}],
    [`/clients/${otherClientId}/notes`, { body: "A note" }],
  ] as const) {
    const res = await admin.post(path, fields);
    assert.equal(res.status, 403, path);
    assert.match(await res.text(), /viewing a client’s portal/, path);
  }
  assert.deepEqual({ updates: count(t.db, "project_update"), calls: count(t.db, "call_request") }, before);
  assert.equal((await admin.get("/portal/autopay/go")).status, 403, "nor can a payment be started by opening an address");

  assert.equal((await admin.get(`/portal/files/${fileId}`)).status, 200);
  const opened = t.db.prepare("select actor_id, context from activity_event where action = 'file.downloaded' order by rowid desc limit 1").get() as { actor_id: string | null; context: string };
  assert.equal(opened.actor_id, mikey);
  assert.match(opened.context, /portal-preview/);
});

test("stopping goes back to the client's page, and the client's own session never noticed", async () => {
  const stopped = await admin.post("/portal-preview/stop", {});
  assert.equal(stopped.status, 303);
  assert.equal(stopped.headers.get("location"), `/clients/${clientId}#portal`);
  assert.equal((await admin.get("/portal")).status, 401, "the admin has no portal of their own");
  assert.doesNotMatch(textOf(await admin.page("/")), /viewing Ann Baker’s portal/);
  assert.doesNotMatch(textOf(await ann.page("/portal")), /viewing/, "the client sees no banner");
  const logged = actions(t.db);
  assert.ok(logged.includes("client-user.portal-preview-started") && logged.includes("client-user.portal-preview-stopped"));
});

test("only someone who may manage the portal can start one, and a forged cookie does nothing", async () => {
  assert.equal((await member.post("/portal-preview", { clientUserId: annId })).status, 403);
  assert.equal((await member.get("/portal")).status, 401);
  assert.equal((await admin.post("/portal-preview", { clientUserId: "00000000-0000-4000-8000-000000000000" })).status, 403);

  // A browser with no HQ sign-in, carrying the cookie by hand, sees the sign-in page.
  const res = await fetch(`${t.origin}/portal`, { redirect: "manual", headers: { cookie: `hq-portal-preview=${annId}` } });
  assert.equal(res.status, 401);
  assert.doesNotMatch(await res.text(), /Mt\. Storm Bakery/);
});

test("turning the client person's access off ends a view at once", async () => {
  assert.equal((await admin.post("/portal-preview", { clientUserId: annId })).status, 303);
  assert.equal((await admin.get("/portal")).status, 200);
  t.db.prepare("update client_user set status = 'disabled' where id = ?").run(annId);
  assert.equal((await admin.get("/portal")).status, 401);
  t.db.prepare("update client_user set status = 'active' where id = ?").run(annId);
  await admin.post("/portal-preview/stop", {});
});
