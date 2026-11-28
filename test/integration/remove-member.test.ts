// Removing a member from HQ over real HTTP (decision 0025): an admin sees
// what Sam still has open, chooses who takes it, and removes him. His
// sessions end and he can't sign in; his open work is Mikey's; what was only
// his is gone; his name stays on past work; his email can be invited again.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { togglePin } from "../../src/dashboard/application/pins.ts";
import * as crm from "../../src/crm/index.ts";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { addTodo } from "../../src/todos/index.ts";
import { events, httpClient, PASSWORD, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let sam: Client;
let mikey: Id;
let samId: Id;
let ada: Id;
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const userId = (email: string) => t.db.prepare("select id from user where email = ?").get(email)?.["id"] as Id;
const one = (sql: string, ...args: string[]) => t.db.prepare(sql).get(...args) as Record<string, unknown>;
const ids: Record<string, string> = {};

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: "https://hq.example" });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = userId("mikey@example.com");
  sam = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
  await sam.get("/");
  samId = userId("sam@example.com");
  await signIn(t, "ada@example.com", "Ada Lovelace", ["manager"]);
  ada = userId("ada@example.com");

  // Sam's open work, and work that is finished.
  const won = await wonProject(t.services, mikey);
  ids["project"] = won.project.id;
  t.db.prepare("update project set owner_id = ? where id = ?").run(samId, won.project.id);
  const client = unwrap(crm.createClient(t.services.crm, mikey, { name: "Gormania Feed", sizeTier: "small" }));
  ids["deal"] = unwrap(crm.createOpportunity(t.services.crm, samId, client.id, { title: "Feed store site", leadSource: "phone" })).id;
  t.db.prepare("update opportunity set owner_id = ? where id = ?").run(samId, ids["deal"]);
  t.db.prepare("update opportunity set owner_id = ? where id = ?").run(samId, won.opportunity.id);
  ids["won"] = won.opportunity.id;
  ids["task"] = unwrap(projects.addTask(t.services.projects, mikey, won.project.id, { title: "Draft the menu page", assigneeId: samId })).id;
  ids["doneTask"] = unwrap(projects.addTask(t.services.projects, mikey, won.project.id, { title: "Pick fonts", assigneeId: samId })).id;
  unwrap(projects.moveTaskStatus(t.services.projects, samId, ids["doneTask"] as Id, "done"));
  ids["todo"] = unwrap(addTodo(t.services.todos, mikey, { title: "Call the feed store", assigneeId: samId })).id;
  ids["shared"] = unwrap(projects.saveFilter(t.services.projects, samId, { name: "Sam’s urgent", query: "priority=urgent", shared: true })).id;
  ids["private"] = unwrap(projects.saveFilter(t.services.projects, samId, { name: "Mine", query: "who=me" })).id;
  unwrap(togglePin(t.services.pins, samId, "/projects"));
  t.db.prepare("insert into calendar_feed (user_id, token_hash, created_at) values (?, 'feed-hash', '2026-11-20T00:00:00Z')").run(samId);
  const started = new Date(Date.now() - 45 * 60_000).toISOString();
  t.db.prepare("insert into time_entry (id, project_id, user_id, worked_on, note, billable, started_at, created_at, updated_at) values ('0190a000-0000-7000-8000-00000000e001', ?, ?, '2026-11-27', 'Menu page', 1, ?, ?, ?)").run(won.project.id, samId, started, started, started);
  t.db.prepare("insert into time_entry (id, project_id, user_id, worked_on, minutes, note, billable, created_at, updated_at) values ('0190a000-0000-7000-8000-00000000e002', ?, ?, '2026-11-26', 90, 'Fonts', 1, 'x', 'x')").run(won.project.id, samId);
});
after(() => t.stop());

test("the removal page lists what Sam has open, with Mikey taking it over by default", async () => {
  const page = textOf(await admin.page(`/people/${samId}/remove`));
  assert.match(page, /Remove Sam Helper from HQ/);
  assert.match(page, /1 open deal 1 active project they own 1 task not done 1 to-do not done 1 shared filter 1 running timer, stopped now and kept/);
  assert.match(await admin.page(`/people/${samId}/remove`), /<option value="[^"]+" selected>Mikey Nichols \(you\)<\/option>/);
  assert.match(textOf(await admin.page("/people")), /Remove from HQ/);
  assert.equal((await sam.get(`/people/${mikey}/remove`)).status, 403, "a member can't open it");
  assert.doesNotMatch(textOf(await sam.page("/people")), /Remove from HQ/);
});

test("removing is refused for yourself, for a non-admin, and without someone active to take over", async () => {
  assert.equal(problemOf(await admin.post(`/people/${mikey}/remove`, { taker: ada })), "You can’t turn off or remove your own account.");
  assert.equal(problemOf(await sam.post(`/people/${ada}/remove`, { taker: samId })), "You don’t have permission to do that.");
  assert.equal(problemOf(await admin.post(`/people/${samId}/remove`, { taker: samId })), "Choose who takes over their work. It must be someone active in HQ.");
  assert.equal(problemOf(await admin.post(`/people/${samId}/remove`, {})), "Choose who takes over their work. It must be someone active in HQ.");
  assert.equal(one("select removed_at from user where id = ?", samId)["removed_at"], null);
});

test("removed: Sam's work is Mikey's, what was only his is gone, and his name stays on past work", async () => {
  assert.equal(doneOf(await admin.post(`/people/${samId}/remove`, { taker: mikey, sure: "1" })), "Sam Helper was removed from HQ. Their open work is now Mikey Nichols’s; their name stays on past work.");

  // He is out, at once and for good.
  const after = await sam.get("/");
  assert.notEqual(after.status, 200);
  const again = httpClient(t.origin);
  const tried = await again.post("/staff/sign-in", { email: "sam@example.com", password: PASSWORD });
  assert.doesNotMatch(tried.headers.get("set-cookie") ?? "", /=\w{10,}/, "his password no longer signs in");
  const row = one("select status, email, removed_at from user where id = ?", samId);
  assert.equal(row["status"], "disabled");
  assert.equal(row["email"], `removed-${samId}@removed.invalid`);
  assert.ok(row["removed_at"]);
  assert.equal(one("select count(*) as n from user_role where user_id = ?", samId)["n"], 0);

  // His open work moved; finished work and history stayed his.
  assert.equal(one("select owner_id from opportunity where id = ?", ids["deal"]!)["owner_id"], mikey);
  assert.equal(one("select owner_id from opportunity where id = ?", ids["won"]!)["owner_id"], samId, "a won deal keeps its owner");
  assert.equal(one("select owner_id from project where id = ?", ids["project"]!)["owner_id"], mikey);
  assert.equal(one("select assignee_id from task where id = ?", ids["task"]!)["assignee_id"], mikey);
  assert.equal(one("select assignee_id from task where id = ?", ids["todo"]!)["assignee_id"], mikey);
  assert.equal(one("select assignee_id from task where id = ?", ids["doneTask"]!)["assignee_id"], samId);
  assert.equal(one("select owner_id from saved_filter where id = ?", ids["shared"]!)["owner_id"], mikey);
  const timer = one("select user_id, minutes from time_entry where id = '0190a000-0000-7000-8000-00000000e001'");
  assert.equal(timer["user_id"], samId, "his time is still his");
  assert.ok(Number(timer["minutes"]) >= 44 && Number(timer["minutes"]) <= 46, `the running timer was stopped with its time: ${timer["minutes"]}`);
  assert.equal(one("select user_id from time_entry where id = '0190a000-0000-7000-8000-00000000e002'")["user_id"], samId);

  // What was only his is gone.
  assert.equal(one("select count(*) as n from saved_filter where id = ?", ids["private"]!)["n"], 0);
  assert.equal(one("select count(*) as n from nav_pin where user_id = ?", samId)["n"], 0);
  assert.equal(one("select count(*) as n from calendar_feed where user_id = ?", samId)["n"], 0);

  // One event says what happened.
  const removed = events(t.db).filter((e) => e.action === "user.removed");
  assert.equal(removed.length, 1);
  assert.deepEqual({ ...removed[0]?.context }, { handedTo: mikey, deals: 1, projects: 1, tasks: 1, todos: 1, calls: 0, bookingHost: false, sharedFilters: 1, timers: 1 });
  assert.equal(removed[0]?.actor, mikey);

  // Gone from People and from choosing people; still named on past work and in the audit history.
  const people = textOf(await admin.page("/people"));
  assert.doesNotMatch(people, /Sam Helper/);
  assert.match(textOf(await admin.page(`/projects/${ids["project"]}/money`)).replace(/\s+/g, " "), /Sam Helper/);
  assert.match(textOf(await admin.page("/activity")), /Sam Helper \(removed\)/);
  assert.equal((await admin.get(`/people/${samId}/remove`)).status, 404);
  assert.equal(problemOf(await admin.post(`/people/${samId}/remove`, { taker: mikey })), "That record doesn’t exist.");
});

test("a removed member stays removed: no turning back on, no roles, no new link", async () => {
  const notThere = "That record doesn’t exist.";
  assert.equal(problemOf(await admin.post(`/people/${samId}/status`, { on: "1" })), notThere);
  assert.equal(problemOf(await admin.post(`/people/${samId}/roles`, { "role-admin": "1" })), notThere);
  assert.equal(problemOf(await admin.post(`/people/${samId}/link`, {})), notThere);
  assert.deepEqual({ ...one("select status, removed_at is not null as removed from user where id = ?", samId) }, { status: "disabled", removed: 1 });
  assert.equal(t.db.prepare("select count(*) as n from user_role where user_id = ?").get(samId)?.["n"], 0);
});

test("his email can be invited again, as someone new", async () => {
  const invited = await admin.post("/people", { name: "Sam Helper", email: "sam@example.com", "role-member": "1" });
  assert.equal(invited.status, 200, problemOf(invited));
  const token = new URL(/value="(https:\/\/hq\.example\/staff\/accept\?token=[A-Za-z0-9_-]{43})"/.exec(await invited.text())?.[1] ?? "https://x/").searchParams.get("token") ?? "";
  const back = httpClient(t.origin);
  assert.equal((await back.post("/staff/accept", { token, name: "Sam Helper", password: PASSWORD })).status, 303);
  assert.equal((await back.get("/")).status, 200);
  const newSam = userId("sam@example.com");
  assert.ok(newSam && newSam !== samId, "a new user, not the old one back");
  assert.equal(one("select assignee_id from task where id = ?", ids["doneTask"]!)["assignee_id"], samId, "past work stays with the old one");
});
