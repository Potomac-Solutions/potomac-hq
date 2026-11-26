// Asking for something from the portal (2026-11-26): it becomes a task or a
// to-do for whoever looks after the client, and the client follows it.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, events, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let stacy: Client;
let grover: Client;
let mikey: Id;
let won: Awaited<ReturnType<typeof wonProject>>;
const said = (res: Response, name: "done" | "problem") => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get(name) ?? "";
const requests = () => t.db.prepare("select id, project_id, task_id, title from client_request order by rowid").all() as { id: Id; project_id: Id | null; task_id: Id; title: string }[];

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  won = await wonProject(t.services, mikey, { client: "Better Days Towing", title: "Website rebuild" });
  stacy = await clientSignedIn(t, admin, won.client.id, "Stacy Roberts", "stacy@betterdays.example");
  const other = await wonProject(t.services, mikey, { client: "Nu-Finish Collision", title: "Landing page" });
  grover = await clientSignedIn(t, admin, other.client.id, "John Groves", "grover@nufinish.example");
});
after(() => t.stop());

test("a request about a project becomes a task on it, for its owner, and the client follows it to done", async () => {
  assert.match(textOf(await stacy.page("/portal")), /Need something changed\?[\s\S]*Ask for something/);
  assert.equal(said(await stacy.post("/portal/requests", { title: " ", details: "" }), "problem"), "Say in a few words what you’d like.");
  const sent = await stacy.post("/portal/requests", { title: "Change our Saturday hours to 8 to 2", details: "Starting next month.\nSundays stay closed.", projectId: won.project.id });
  assert.equal(said(sent, "done"), "Sent. Potomac Solutions has it, and you can follow it here.");
  const [request] = requests();
  const task = t.services.projects.tasks.get(request?.task_id as Id);
  assert.deepEqual([task?.projectId, task?.title, task?.assigneeId, task?.status], [won.project.id, "Change our Saturday hours to 8 to 2", mikey, "todo"]);
  assert.match(task?.description ?? "", /From Stacy Roberts, in the portal\.\n\nStarting next month\./);

  assert.match(textOf(await stacy.page("/portal/requests")), /Change our Saturday hours to 8 to 2 Received[\s\S]*Sundays stay closed[\s\S]*Website rebuild/);
  assert.match(textOf(await stacy.page("/portal")), /You have 1 open\./);
  unwrap(projects.moveTaskStatus(t.services.projects, mikey, task?.id as Id, "doing"));
  assert.match(textOf(await stacy.page("/portal/requests")), /Being worked on/);
  unwrap(projects.moveTaskStatus(t.services.projects, mikey, task?.id as Id, "done"));
  assert.match(textOf(await stacy.page("/portal/requests")), /Change our Saturday hours to 8 to 2 Done/);
  assert.doesNotMatch(textOf(await stacy.page("/portal")), /You have \d+ open/);

  const staff = textOf(await admin.page(`/clients/${won.client.id}`));
  assert.match(staff, /Requests from the client[\s\S]*Change our Saturday hours to 8 to 2 · Done/);
  assert.ok(events(t.db).some((one) => one.action === "request.received" && one.actor === null));
});

test("a request about nothing in particular becomes a to-do about the client; saying no shows the client why", async () => {
  await stacy.post("/portal/requests", { title: "Can you add our new tow truck photo?", details: "" });
  const request = requests().at(-1);
  assert.equal(request?.project_id, null);
  const todo = t.db.prepare("select project_id, organization_id, assignee_id from task where id = ?").get(request?.task_id as Id);
  assert.deepEqual([todo?.["project_id"], todo?.["organization_id"], todo?.["assignee_id"]], [null, won.client.id, mikey]);

  assert.equal(said(await admin.post(`/requests/${request?.id}/decline`, { client: won.client.id, note: "" }), "problem"), "Say why, in a line: the client reads it.");
  assert.equal(said(await admin.post(`/requests/${request?.id}/decline`, { client: won.client.id, note: "That’s a new page: we’ll send a change with its price first." }), "done"), "Done. The client sees it isn’t going ahead, and why.");
  assert.match(textOf(await stacy.page("/portal/requests")), /Can you add our new tow truck photo\? Not going ahead[\s\S]*Potomac Solutions: “That’s a new page: we’ll send a change with its price first\.”/);
  assert.equal(said(await admin.post(`/requests/${request?.id}/decline`, { client: won.client.id, note: "again" }), "problem"), "That request is already done or closed.");
});

test("another client's project can't be named; another client sees none of these; someone who can't work tasks can't say no", async () => {
  assert.equal(said(await grover.post("/portal/requests", { title: "Sneaky", projectId: won.project.id }), "problem"), "That isn’t here.");
  assert.match(textOf(await grover.page("/portal/requests")), /What you’ve asked for Nothing yet\./);
  await stacy.post("/portal/requests", { title: "One more thing", projectId: won.project.id });
  const request = requests().at(-1);
  // A client's own session is no staff actor.
  assert.notEqual(said(await stacy.post(`/requests/${request?.id}/decline`, { client: won.client.id, note: "no" }), "done"), "Done. The client sees it isn’t going ahead, and why.");
  assert.equal(t.db.prepare("select declined_at from client_request where id = ?").get(request?.id as Id)?.["declined_at"], null);
});

test("twenty a day from one person, then a plain refusal", async () => {
  const before = requests().length;
  for (let n = before; n < 20; n += 1) await stacy.post("/portal/requests", { title: `Ask ${n}` });
  assert.equal(said(await stacy.post("/portal/requests", { title: "One too many" }), "problem"), "That’s a lot of requests for one day. Send the rest tomorrow, or put them together in one.");
});
