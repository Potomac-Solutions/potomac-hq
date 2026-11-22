// v1.0, managing users over real HTTP: an admin invites someone, they use
// the one-time link and get the invited roles, and the admin changes their
// roles, switches them off and makes them a new link.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Id } from "../../src/shared/index.ts";
import { events, httpClient, PASSWORD, signIn, TEST_PASSWORD_COST, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let mikey: Id;
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const userId = (email: string) => t.db.prepare("select id from user where email = ?").get(email)?.["id"] as Id;

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: "https://hq.example" });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = userId("mikey@example.com");
});
after(() => t.stop());

let sam: Client;

test("an admin invites someone, who gets their user and roles when they use the link", async () => {
  const page = await admin.page("/people");
  assert.match(textOf(page), /Mikey Nichols You mikey@example\.com Admin · Active/);
  assert.match(page, /Nobody is waiting on an invite\./);

  assert.equal(problemOf(await admin.post("/people", { name: "Sam Helper", email: "sam@example.com" })), "Choose at least one role.");
  assert.equal(problemOf(await admin.post("/people", { name: "", email: "sam@example.com", "role-member": "1" })), "Enter their name.");
  assert.equal(problemOf(await admin.post("/people", { name: "Me Again", email: "MIKEY@example.com", "role-member": "1" })), "Someone with that email already has an account.");

  const invited = await admin.post("/people", { name: "Sam Helper", email: "Sam@Example.com", "role-manager": "1", "role-owner": "1" });
  assert.equal(invited.status, 200);
  assert.equal(invited.headers.get("cache-control"), "no-store");
  const html = await invited.text();
  const link = /value="(https:\/\/hq\.example\/staff\/accept\?token=[A-Za-z0-9_-]{43})"/.exec(html)?.[1] ?? "";
  assert.ok(link, "the admin is shown the link");
  const token = new URL(link).searchParams.get("token") ?? "";
  assert.ok(!JSON.stringify(events(t.db)).includes(token), "the link is not in the audit log");
  assert.match(textOf(await admin.page("/people")), /Sam Helper sam@example\.com Manager · Invited, not signed in yet/);
  assert.match(problemOf(await admin.post("/people", { name: "Sam", email: "sam@example.com", "role-member": "1" })), /already has an invite/);

  sam = httpClient(t.origin);
  const accepted = await sam.post("/staff/accept", { token, name: "Sam Helper", password: PASSWORD });
  assert.equal(accepted.status, 303);
  assert.match(await sam.page("/"), /Dashboard|Potomac HQ/);
  assert.equal((await sam.get("/money")).status, 200, "a manager opens the Money page");
  assert.deepEqual(t.services.session.users.rolesOf(userId("sam@example.com")), ["manager"]);
  assert.equal(t.db.prepare("select count(*) as n from user_invite").get()?.["n"], 0, "the invite is used up");

  const made = events(t.db).filter((e) => e.action === "user.invited" || (e.action === "user.created" && e.context["invitedBy"]));
  assert.deepEqual(made.map((e) => [e.action, e.context["roles"]]), [["user.invited", ["manager"]], ["user.created", ["manager"]]]);
  assert.equal(made[1]?.context["invitedBy"], mikey);
});

test("an invite that was withdrawn makes nobody a user", async () => {
  const invited = await admin.post("/people", { name: "Eve Early", email: "eve@example.com", "role-admin": "1" });
  const token = /token=([A-Za-z0-9_-]{43})/.exec(await invited.text())?.[1] ?? "";
  const invite = t.db.prepare("select id from user_invite where email = 'eve@example.com'").get()?.["id"] as string;
  assert.equal(doneOf(await admin.post(`/invites/${invite}/withdraw`, {})), "Invite withdrawn.");
  const eve = httpClient(t.origin);
  await eve.post("/staff/accept", { token, name: "Eve Early", password: PASSWORD });
  assert.equal(userId("eve@example.com"), undefined);
  assert.equal((await eve.get("/")).status, 401, "the link made no sign-in account");
  const accounts = t.db.prepare("select count(*) as n from kit_document where collection = 'accounts' and fields like '%eve@example.com%'").get()?.["n"];
  assert.equal(accounts, 0);

  // So the same email can be invited again, and that link works.
  const again = await admin.post("/people", { name: "Eve Early", email: "eve@example.com", "role-member": "1" });
  const fresh = /token=([A-Za-z0-9_-]{43})/.exec(await again.text())?.[1] ?? "";
  assert.equal((await eve.post("/staff/accept", { token: fresh, name: "Eve Early", password: PASSWORD })).status, 303);
  await eve.get("/");
  assert.ok(userId("eve@example.com"));
});

test("roles change at once, and the last admin stays an admin", async () => {
  const samId = userId("sam@example.com");
  assert.equal(doneOf(await admin.post(`/people/${samId}/roles`, { "role-member": "1" })), "Roles saved.");
  assert.equal((await sam.get("/money")).status, 403, "the next request already has the new roles");
  assert.equal(problemOf(await admin.post(`/people/${samId}/roles`, {})), "Choose at least one role.");
  assert.match(problemOf(await admin.post(`/people/${mikey}/roles`, { "role-member": "1" })), /needs an admin/);

  // A second admin, and now the first may step down. Then back.
  await admin.post(`/people/${samId}/roles`, { "role-admin": "1" });
  assert.equal(doneOf(await sam.post(`/people/${mikey}/roles`, { "role-member": "1" })), "Roles saved.");
  assert.match(problemOf(await admin.post("/people", { name: "X", email: "x@example.com", "role-member": "1" })), /permission/);
  assert.match(problemOf(await sam.post(`/people/${samId}/roles`, { "role-member": "1" })), /needs an admin/);
  await sam.post(`/people/${mikey}/roles`, { "role-admin": "1" });
  await admin.post(`/people/${samId}/roles`, { "role-member": "1" });
  const changes = events(t.db).filter((e) => e.action === "user.roles-changed");
  assert.deepEqual(changes[0]?.context, { from: ["manager"], to: ["member"] });
});

test("switching someone off signs them out, and a new link lets them back in once on", async () => {
  const samId = userId("sam@example.com");
  assert.match(problemOf(await admin.post(`/people/${mikey}/status`, { on: "0" })), /your own account/);
  assert.match(doneOf(await admin.post(`/people/${samId}/status`, { on: "0" })), /^Saved\./);
  assert.equal((await sam.get("/clients")).status, 401, "their session ended");
  const again = httpClient(t.origin);
  assert.notEqual((await again.post("/staff/sign-in", { email: "sam@example.com", password: PASSWORD })).headers.get("location"), "/");
  assert.match(problemOf(await admin.post(`/people/${samId}/link`, {})), /turned off/);
  assert.match(textOf(await admin.page("/people")), /Sam Helper sam@example\.com Member · Turned off/);

  await admin.post(`/people/${samId}/status`, { on: "1" });
  const made = await admin.post(`/people/${samId}/link`, {});
  assert.equal(made.status, 200);
  const token = /token=([A-Za-z0-9_-]{43})/.exec(await made.text())?.[1] ?? "";
  const back = httpClient(t.origin);
  assert.equal((await back.post("/staff/accept", { token, password: "a brand new password" })).status, 303);
  assert.equal((await back.get("/clients")).status, 200);
  assert.deepEqual(events(t.db).filter((e) => /^user\.(disabled|enabled|reset-link-issued)$/.test(e.action)).map((e) => [e.action, e.actor === mikey]), [["user.disabled", true], ["user.enabled", true], ["user.reset-link-issued", true]]);
  sam = back;
});

test("a member sees the list and can change nothing", async () => {
  const page = await sam.page("/people");
  assert.match(page, /Mikey Nichols/);
  assert.doesNotMatch(page, /Invite someone to HQ|Save roles|Turn account off|New password link|Invites/);
  for (const [path, fields] of [["/people", { name: "Z", email: "z@example.com", "role-admin": "1" }], [`/people/${mikey}/roles`, { "role-member": "1" }], [`/people/${mikey}/status`, { on: "0" }], [`/people/${mikey}/link`, {}]] as const) {
    assert.match(problemOf(await sam.post(path, fields)), /permission/, path);
  }
});
