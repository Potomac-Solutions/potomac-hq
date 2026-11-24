// The calendar feed (decision 0007, section 10) against a real database and
// over real HTTP, with no one signed in on the calendar's side.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, httpClient, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let samId: Id;
let address = "";
const day = (days: number) => Temporal.Now.plainDateISO("America/New_York").add({ days }).toString();
const ics = (date: string) => date.replace(/-/g, "");
const outside = () => httpClient(t.origin);
const fetchFeed = async (path: string) => {
  const res = await outside().get(path);
  return { status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text() };
};
const addressIn = (html: string) => new URL(/<input readonly value="([^"]+)">/.exec(html)?.[1] ?? "http://x/none").pathname;

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  samId = t.db.prepare("select id from user where email = 'sam@example.com'").get()?.["id"] as Id;
  const deps = t.services.projects;
  const website = (await wonProject(t.services, mikeyId, { client: "Better Days Towing", title: "Better Days website" })).project.id;
  const shop = (await wonProject(t.services, mikeyId, { client: "Tailgate Farms", title: "Tailgate shop" })).project.id;
  unwrap(projects.addTask(deps, mikeyId, website, { title: "Build the homepage", assigneeId: samId, startOn: day(1), dueOn: day(6) }));
  unwrap(projects.addTask(deps, mikeyId, website, { title: "Swap the truck photos", assigneeId: samId, dueOn: day(2) }));
  unwrap(projects.addTask(deps, mikeyId, website, { title: "Someday: a blog", assigneeId: samId }));
  const done = unwrap(projects.addTask(deps, mikeyId, website, { title: "Pick the colours", assigneeId: samId, dueOn: day(-1) }));
  unwrap(projects.moveTaskStatus(deps, mikeyId, done.id, "done"));
  unwrap(projects.addTask(deps, mikeyId, shop, { title: "Load the products", assigneeId: mikeyId, dueOn: day(3) }));
  unwrap(projects.addMilestone(deps, mikeyId, website, { name: "Launch", dueOn: day(10) }));
  unwrap(projects.addMilestone(deps, mikeyId, shop, { name: "Shop opens", dueOn: day(12) }));
  await sam.submit("/todos", { title: "Renew the domain", dueOn: day(4) });
});
after(() => t.stop());

test("an address is shown once, on the answer to making it, and only its hash is kept", async () => {
  assert.match(textOf(await sam.page("/calendar-feed")), /No address yet/);
  const res = await sam.post("/calendar-feed", { filterId: "" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  const html = await res.text();
  address = addressIn(html);
  assert.match(address, /^\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
  assert.match(html, /This page won't show it again/);
  const token = /\/calendar\/(.+)\.ics/.exec(address)?.[1] ?? "";
  const stored = t.db.prepare("select token_hash from calendar_feed where user_id = ?").get(samId)?.["token_hash"];
  assert.equal(stored, createHash("sha256").update(token).digest("hex"));
  assert.doesNotMatch(JSON.stringify(t.db.prepare("select * from calendar_feed").all()), new RegExp(token));
  assert.ok(actions(t.db).includes("calendar.feed-made"));
  const page = textOf(await sam.page("/calendar-feed"));
  assert.match(page, /Your address is on .* No calendar has checked it yet\./);
  assert.doesNotMatch(page, new RegExp(token), "the page never shows it again");
});

test("the feed: your open tasks with due dates, start to due, and your projects' milestones, with no one signed in", async () => {
  const feed = await fetchFeed(address);
  assert.equal(feed.status, 200);
  assert.equal(feed.type, "text/calendar; charset=utf-8");
  assert.match(feed.body, /X-WR-CALNAME:HQ: Sam's work\r\n/);
  assert.match(feed.body, new RegExp(`DTSTART;VALUE=DATE:${ics(day(1))}\\r\\nDTEND;VALUE=DATE:${ics(day(7))}\\r\\nSUMMARY:Build the homepage\\r\\n`));
  assert.match(feed.body, /SUMMARY:Swap the truck photos\r\n/);
  assert.match(feed.body, /SUMMARY:Renew the domain\r\nDESCRIPTION:A to-do\\nOpen it in HQ: http/);
  assert.match(feed.body, /SUMMARY:Milestone: Launch\r\n/, "a project Sam has tasks on");
  for (const absent of ["Someday: a blog", "Pick the colours", "Load the products", "Shop opens"]) assert.doesNotMatch(feed.body, new RegExp(absent), absent);
  assert.match(feed.body, /URL:http:\/\/127\.0\.0\.1:\d+\/tasks\/[0-9a-f-]{36}\r\n/);
  assert.notEqual(t.db.prepare("select last_used_at from calendar_feed where user_id = ?").get(samId)?.["last_used_at"], null);
  assert.match(textOf(await sam.page("/calendar-feed")), /A calendar last checked it /);
});

test("a new address stops the old one", async () => {
  const res = await sam.post("/calendar-feed", { filterId: "" });
  const html = await res.text();
  assert.match(html, /Your old address has stopped working/);
  const next = addressIn(html);
  assert.notEqual(next, address);
  assert.equal((await fetchFeed(address)).status, 404);
  assert.equal((await fetchFeed(next)).status, 200);
  address = next;
});

test("it can follow a saved filter; deleting the filter puts it back to its usual contents", async () => {
  await sam.submit("/work/filters", { name: "Website, soon", query: "q=homepage" });
  const filterId = t.db.prepare("select id from saved_filter where name = 'Website, soon'").get()?.["id"] as Id;
  assert.match(await sam.page("/calendar-feed"), /The saved filter “Website, soon”/);
  address = addressIn(await (await sam.post("/calendar-feed", { filterId })).text());
  const feed = await fetchFeed(address);
  assert.match(feed.body, /X-WR-CALNAME:HQ: Website\\, soon\r\n/);
  assert.match(feed.body, /SUMMARY:Build the homepage\r\n/);
  assert.doesNotMatch(feed.body, /Swap the truck photos|Milestone:/);
  assert.match(textOf(await sam.page("/calendar-feed")), /It shows the tasks in your filter “Website, soon”/);

  const someoneElses = await mikey.submit("/work/filters", { name: "Mikey's private", query: "who=me" });
  assert.match(someoneElses.html, /Filter saved\./);
  const privateId = t.db.prepare("select id from saved_filter where name = 'Mikey''s private'").get()?.["id"] as Id;
  const refused = await sam.post("/calendar-feed", { filterId: privateId });
  assert.match(new URL("http://x" + (refused.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /doesn’t exist/);

  await sam.submit(`/work/filters/${filterId}/remove`, {});
  assert.match((await fetchFeed(address)).body, /X-WR-CALNAME:HQ: Sam's work\r\n[\s\S]*Swap the truck photos/);
});

test("stopping it, and addresses that aren't one", async () => {
  const stopped = await sam.submit("/calendar-feed/stop", {});
  assert.match(stopped.html, /Your calendar address has stopped working\./);
  assert.equal((await fetchFeed(address)).status, 404);
  assert.ok(actions(t.db).includes("calendar.feed-stopped"));
  for (const path of ["/calendar/short.ics", `/calendar/${"a".repeat(43)}.ics`, `/calendar/${"a".repeat(43)}.txt`]) assert.equal((await fetchFeed(path)).status, 404, path);
  assert.match(textOf(await sam.page("/todos")), /See them in your calendar/);
  assert.match(textOf(await sam.page("/settings")), /Set up your calendar feed/);
});
