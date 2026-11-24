// The work table (decision 0007, section 3) against a real database and over
// real HTTP: filters in the address, sorting, chosen columns, saved filters
// (private, shared, pinned) and the CSV.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let samId: Id;
let website: Id;
const day = (days: number) => Temporal.Now.plainDateISO("America/New_York").add({ days }).toString();
const order = (html: string) => [...html.matchAll(/<td><span class="hq-ref">[A-Z0-9]+-\d+<\/span> <a href="\/tasks\/[0-9a-f-]{36}">([^<]+)<\/a><\/td>/g)].map((m) => m[1]);

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  samId = t.db.prepare("select id from user where email = 'sam@example.com'").get()?.["id"] as Id;
  const deps = t.services.projects;
  const { project } = await wonProject(t.services, mikeyId, { client: "Better Days Towing", title: "Better Days website" });
  const proof = unwrap(projects.addTask(deps, mikeyId, project.id, { title: "Send the homepage proof", assigneeId: mikeyId, priority: "high", dueOn: day(-1) }));
  unwrap(projects.addTask(deps, mikeyId, project.id, { title: "Swap the truck photos", assigneeId: samId, dueOn: day(20) }));
  const domain = unwrap(projects.addTask(deps, mikeyId, project.id, { title: "Point the domain at Netlify", priority: "urgent" }));
  unwrap(projects.moveTaskStatus(deps, mikeyId, domain.id, "done"));
  website = unwrap(projects.addLabel(deps, mikeyId, { name: "Website", colour: "blue" })).id;
  unwrap(projects.setTaskLabels(deps, mikeyId, proof.id, { labelIds: [website] }));
  await mikey.post("/todos", { title: "Renew the Netlify card", dueOn: day(2) });
});
after(() => t.stop());

test("all open work, to-dos and project tasks, sorted by due date with no date last", async () => {
  const page = await mikey.page("/work");
  assert.match(page, /<h1>All work<\/h1>/);
  assert.deepEqual(order(page), ["Send the homepage proof", "Renew the Netlify card", "Swap the truck photos"]);
  assert.match(page, /<li data-colour="blue">Website<\/li>/);
  assert.match(page, />To-do</, "a to-do's project cell says so");
  assert.doesNotMatch(page, /Point the domain/, "finished work is left out by default");
});

test("filters read from the address: people, labels, due windows, projects, words, and finished work", async () => {
  assert.deepEqual(order(await mikey.page(`/work?who=${samId}`)), ["Swap the truck photos"]);
  assert.deepEqual(order(await mikey.page(`/work?label=${website}`)), ["Send the homepage proof"]);
  assert.deepEqual(order(await mikey.page("/work?due=overdue")), ["Send the homepage proof"]);
  assert.deepEqual(order(await mikey.page("/work?project=none")), ["Renew the Netlify card"]);
  assert.deepEqual(order(await mikey.page("/work?q=netlify&show=all")), ["Renew the Netlify card", "Point the domain at Netlify"]);
  assert.deepEqual(order(await sam.page("/work?who=me")), ["Swap the truck photos"], "'me' is whoever is looking");
  const none = await mikey.page("/work?status=blocked");
  assert.match(none, /Nothing matches/);
  assert.match(none, /href="\/work">Clear it<\/a>/);
});

test("every column sorts both ways by a link, and says which way it is sorted", async () => {
  const asc = await mikey.page("/work?sort=priority&dir=asc");
  assert.deepEqual(order(asc), ["Send the homepage proof", "Renew the Netlify card", "Swap the truck photos"]);
  assert.match(asc, /<th scope="col" aria-sort="ascending"><a href="\/work\?sort=priority&amp;dir=desc">Priority<\/a><\/th>/);
  assert.deepEqual(order(await mikey.page("/work?sort=title&dir=desc")), ["Swap the truck photos", "Send the homepage proof", "Renew the Netlify card"]);
});

test("columns are each person's own choice", async () => {
  const saved = await mikey.submit("/work/columns", { "column-client": "1", "column-estimate": "1", query: "who=me" });
  assert.match(saved.location, /^\/work\?who=me&done=/);
  assert.match(saved.html, /Columns saved\./);
  assert.match(saved.html, />Client<\/a><\/th>/);
  assert.doesNotMatch(saved.html, />Priority<\/a><\/th>/);
  assert.match(await sam.page("/work"), />Priority<\/a><\/th>/, "Sam still has the default");
  assert.ok(actions(t.db).includes("work.columns-chosen"));
  await mikey.submit("/work/columns", { "column-project": "1", "column-who": "1", "column-status": "1", "column-priority": "1", "column-due": "1", "column-labels": "1" });
});

test("a saved filter is private until shared; only its owner pins, shares or deletes it; pins show in the sidebar", async () => {
  const refused = await mikey.submit("/work/filters", { name: "Everything", query: "sort=due" });
  assert.match(refused.html, /Choose something to filter by first/);

  const made = await mikey.submit("/work/filters", { name: "Overdue for me", query: "due=overdue&who=me&evil=1", pinned: "1" });
  assert.match(made.html, /Filter saved\./);
  const id = t.db.prepare("select id, query from saved_filter where name = 'Overdue for me'").get() as { id: string; query: string };
  assert.equal(id.query, "who=me&due=overdue", "only filter fields are kept, in order");

  const filtered = await mikey.page("/work?who=me&due=overdue");
  assert.match(filtered, /<h1>Overdue for me<\/h1>/);
  assert.match(filtered, /<a href="\/work\?who=me&amp;due=overdue" aria-current="page">Overdue for me<\/a>/);
  assert.match(await mikey.page("/today"), /href="\/work\?who=me&amp;due=overdue"[^>]*>Overdue for me<\/a>/, "pinned to Mikey's sidebar");

  assert.doesNotMatch(await sam.page("/work"), /Overdue for me/, "not shared yet");
  const stranger = await sam.post(`/work/filters/${id.id}/remove`, {});
  assert.match(new URL(t.origin + (stranger.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /doesn’t exist/);

  await mikey.submit(`/work/filters/${id.id}`, { shared: "1" });
  const shared = await sam.page("/work");
  assert.match(shared, /Overdue for me/);
  assert.match(textOf(shared), /Overdue for me Mikey Nichols Not yours Shared/);
  const forbidden = await sam.post(`/work/filters/${id.id}`, { pinned: "1" });
  assert.match(new URL(t.origin + (forbidden.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /permission/);
  assert.doesNotMatch(await sam.page("/today"), /href="\/work\?who=me&amp;due=overdue"/, "a shared filter isn't pinned to anyone else's sidebar");

  const gone = await mikey.submit(`/work/filters/${id.id}/remove`, {});
  assert.match(gone.html, /Filter deleted\./);
  for (const action of ["filter.saved", "filter.changed", "filter.removed"]) assert.ok(actions(t.db).includes(action), action);
});

test("the CSV has the same rows in the same order, with every column", async () => {
  const res = await mikey.get("/work.csv?who=me&sort=title&dir=asc");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename="work-\d{4}-\d{2}-\d{2}\.csv"/);
  const lines = (await res.text()).replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines[0], "Task,Project,Client,Who,Status,Priority,Due,Labels,Estimate (hours)");
  assert.deepEqual(
    lines.slice(1).map((line) => line.split(",")[0]),
    ["Renew the Netlify card", "Send the homepage proof"],
  );
  assert.match(lines[2] ?? "", /^Send the homepage proof,Better Days website,Better Days Towing,Mikey Nichols,To do,High,\d{4}-\d{2}-\d{2},Website,$/);
  const outsider = await (await import("../support/harness.ts")).httpClient(t.origin).get("/work.csv");
  assert.equal(outsider.status, 404);
});
