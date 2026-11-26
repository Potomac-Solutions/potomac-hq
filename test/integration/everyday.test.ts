// Everyday buttons (Mikey, 2026-11-25) over real HTTP: saved replies,
// duplicate clients and merging them, and booked calls in the calendar feed.
// Undo is decision 0014's, tested with it; here, only what was added back to
// it before staging: undoing a finished repeat takes its next one back too.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import * as projects from "../../src/projects/index.ts";
import * as talk from "../../src/projects/application/comments.ts";
import type { Id } from "../../src/shared/index.ts";
import { httpClient, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
const userId = (email: string) => t.db.prepare("select id from user where email = ?").get(email)?.["id"] as Id;
const query = (res: Response, name: string) => new URL("http://x" + (res.headers.get("location") ?? "")).searchParams.get(name) ?? "";

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  member = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
});
after(() => t.stop());

test("saved replies: saved once, offered beside a message to a client", async () => {
  assert.match(query(await admin.post("/replies", { title: "Proof ready", body: "Hi {first name}, your proof is ready to look over." }), "done"), /Saved/);
  assert.match(textOf(await admin.page("/replies")), /Proof ready/);
  const mikey = userId("mikey@example.com");
  const { project } = await wonProject(t.services, mikey, { client: "Reply Bakery" });
  assert.match(await admin.page(`/projects/${project.id}`), /Proof ready/);
  const id = t.db.prepare("select id from saved_reply where title = 'Proof ready'").get()?.["id"] as string;
  await admin.post(`/replies/${id}/remove`, {});
  assert.doesNotMatch(textOf(await admin.page("/replies")), /Proof ready/);
});

test("duplicates: a name like one already here asks first, and merging moves everything", async () => {
  const mikey = userId("mikey@example.com");
  const { client: keep } = await wonProject(t.services, mikey, { client: "Mountaineer Plumbing LLC" });
  const asked = await admin.submit("/clients", { name: "Mountaineer Plumbing" });
  assert.match(textOf(asked.html), /“Mountaineer Plumbing LLC” is already in HQ, and looks like the same business/);
  assert.match(textOf(asked.html), /It’s a different business: add it anyway/);
  const made = await admin.post("/clients", { name: "Mountaineer Plumbing", different: "1" });
  assert.match(query(made, "done"), /./);
  const dupe = t.db.prepare("select id from client_organization where name = 'Mountaineer Plumbing'").get()?.["id"] as string;
  unwrap(crm.addContact(t.services.crm, mikey, dupe as Id, { name: "Rita Okafor", email: "rita@example.com" }));

  const page = textOf(await admin.page(`/clients/${dupe}`));
  assert.match(page, /Is this a duplicate\? Another client looks the same/);
  assert.match(page, /Mountaineer Plumbing LLC \(looks the same\)/);
  assert.equal(query(await member.post(`/clients/${dupe}/merge`, { into: keep.id }), "done"), "", "members may not merge");
  assert.match(query(await admin.post(`/clients/${dupe}/merge`, { into: keep.id }), "done"), /Merged/);
  const after = t.db.prepare("select name, status from client_organization where id = ?").get(dupe) as Record<string, string>;
  assert.match(after["name"] ?? "", /\(merged\)/);
  assert.equal(after["status"], "former");
  assert.equal(t.db.prepare("select count(*) as n from contact where organization_id = ?").get(dupe)?.["n"], 0, "nothing left on the duplicate");
  assert.match(query(await admin.post(`/clients/${keep.id}/merge`, { into: keep.id }), "problem"), /different client/);
});

test("booked calls: in the host's calendar feed, at their times", async () => {
  const sam = userId("sam@example.com");
  const start = Temporal.Now.instant().add({ hours: 48 }).round({ smallestUnit: "minute" });
  t.db
    .prepare("insert into booking (id, kind, status, starts_at, ends_at, name, email, topic, host_id, created_at) values ('b-feed', 'public', 'booked', ?, ?, 'Dana Hill', 'dana@example.com', 'A new website', ?, ?)")
    .run(start.toString(), start.add({ minutes: 30 }).toString(), sam, Temporal.Now.instant().toString());
  const html = await (await member.post("/calendar-feed", { filterId: "" })).text();
  const address = new URL(/<input readonly value="([^"]+)">/.exec(html)?.[1] ?? "http://x/none").pathname;
  const body = await (await httpClient(t.origin).get(address)).text();
  assert.match(body, /SUMMARY:Call with Dana Hill/);
  assert.match(body, /DTSTART:\d{8}T\d{6}Z/);
  assert.match(body, /get-ready\/b-feed/);
});

const undoOf = (html: string) => /action="(\/undo\/[0-9a-f]{32})"/.exec(html)?.[1] ?? "";

test("Undo after finishing a repeating task takes its next one back, unless it has work on it", async () => {
  const mikey = userId("mikey@example.com");
  const { project } = await wonProject(t.services, mikey, { client: "Weekly Bakery" });
  const task = unwrap(projects.addTask(t.services.projects, mikey, project.id, { title: "Post the specials", dueOn: "2026-12-01" }));
  unwrap(projects.setTaskRepeat(t.services.projects, mikey, task.id, { every: "1", unit: "week", from: "due" }));
  const finished = await admin.submit(`/tasks/${task.id}/status`, { to: "done" });
  assert.match(textOf(finished.html), /It repeats, so the next one is due/);
  const next = t.services.projects.repeats.nextOf(task.id);
  assert.ok(next, "the next one was made");
  assert.match(textOf(finished.html), /Post the specials: done, and its next one made/, "Undo is offered, saying so");
  const undone = await admin.submit(undoOf(finished.html), {});
  assert.match(textOf(undone.html), /Task moved back\. The next one it made is gone too\./);
  assert.equal(t.services.projects.tasks.get(task.id)?.status, "todo");
  assert.equal(t.services.projects.tasks.get(next as Id), null, "the next one is gone");
  assert.equal(t.services.projects.repeats.nextOf(task.id), null);

  // Finished again: a new next one. Someone comments on it; now Undo leaves it be.
  const again = await admin.submit(`/tasks/${task.id}/status`, { to: "done" });
  const second = t.services.projects.repeats.nextOf(task.id) as Id;
  assert.ok(second);
  unwrap(talk.addTaskComment(t.services.projects, mikey, second, "Croissants this week"));
  const kept = await admin.submit(undoOf(again.html), {});
  assert.match(textOf(kept.html), /already has work on it, so it stays/);
  assert.equal(t.services.projects.tasks.get(task.id)?.status, "todo");
  assert.ok(t.services.projects.tasks.get(second), "the next one with a comment stays");
  await admin.submit(`/tasks/${task.id}/status`, { to: "done" });
  assert.equal(t.db.prepare("select count(*) as n from task where previous_id = ?").get(task.id)?.["n"], 1, "finishing it again makes no second one");
});

test("Undo after ticking off a repeating to-do takes its next one back", async () => {
  await member.post("/todos", { title: "Water the plants", dueOn: "2026-12-01" });
  const id = t.db.prepare("select id from task where title = 'Water the plants'").get()?.["id"] as Id;
  const sam = userId("sam@example.com");
  unwrap(projects.setTaskRepeat(t.services.projects, sam, id, { every: "3", unit: "day", from: "due" }));
  const ticked = await member.submit(`/todos/${id}/done`, { back: "todos" });
  const next = t.services.projects.repeats.nextOf(id);
  assert.ok(next);
  const undone = await member.submit(undoOf(ticked.html), {});
  assert.match(textOf(undone.html), /Back on the list\. The next one it made is gone too\./);
  assert.equal(t.services.projects.tasks.get(next as Id), null);
});
