// Notices and reminders (decision 0007, section 8) against a real database
// and over real HTTP.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as notices from "../../src/notices/index.ts";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let samId: Id;
let website: Id;
const bell = (html: string) => /<span class="hq-bell-count">(\d+)/.exec(html)?.[1] ?? "0";
const count = (userId: Id) => Number(t.db.prepare("select count(*) as n from notice where user_id = ?").get(userId)?.["n"]);
const problemOf = (location: string | null) => new URL("http://x" + (location ?? "")).searchParams.get("problem") ?? "";

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  samId = t.db.prepare("select id from user where email = 'sam@example.com'").get()?.["id"] as Id;
  website = (await wonProject(t.services, mikeyId, { client: "Better Days Towing", title: "Better Days website" })).project.id;
});
after(() => t.stop());

test("a task given to someone else tells them; one you take yourself doesn't", async () => {
  await mikey.submit(`/projects/${website}/tasks`, { title: "Swap the truck photos", assigneeId: samId });
  await mikey.submit(`/projects/${website}/tasks`, { title: "Point the domain", assigneeId: mikeyId });
  assert.equal(count(samId), 1);
  assert.equal(count(mikeyId), 0);
  const page = await sam.page("/today");
  assert.equal(bell(page), "1");
  assert.match(page, /Notices<\/span><span class="hq-bell-count">1<span class="sr-only"> new<\/span>/);
  assert.match(textOf(page), /New for you Mikey Nichols gave you “Swap the truck photos”/);

  const list = await sam.page("/notices");
  assert.match(textOf(list), /1 new Mikey Nichols gave you “Swap the truck photos” \(new\)/);
  const href = /<a href="(\/notices\/[0-9a-f-]{36})">Mikey Nichols gave you/.exec(list)?.[1] ?? "";
  assert.equal((await mikey.get(href)).headers.get("location"), "/notices", "not someone else's");
  const opened = await sam.get(href);
  assert.match(opened.headers.get("location") ?? "", /^\/tasks\/[0-9a-f-]{36}$/);
  assert.equal(bell(await sam.page("/today")), "0");
  assert.doesNotMatch(await sam.page("/today"), /New for you/);
});

test("reassigning tells the new person; other edits don't; to-dos and quick add tell too", async () => {
  const task = unwrap(projects.addTask(t.services.projects, mikeyId, website, { title: "Write the about page" }));
  assert.equal(count(samId), 1);
  unwrap(projects.updateTask(t.services.projects, mikeyId, task.id, { title: "Write the about page", assigneeId: samId }));
  assert.equal(count(samId), 2);
  unwrap(projects.updateTask(t.services.projects, mikeyId, task.id, { title: "Write the About page", assigneeId: samId, priority: "high" }));
  assert.equal(count(samId), 2, "still Sam's: nothing new");
  await mikey.submit("/todos", { title: "Call Dale back", assigneeId: samId });
  await mikey.submit("/add", { text: "Order the yard sign @sam-rivers", skip: "" });
  assert.equal(count(samId), 4);
});

test("a mention tells the person mentioned, with the comment's first words; editing in a new mention tells them", async () => {
  const task = t.db.prepare("select id from task where title = 'Swap the truck photos'").get()?.["id"] as Id;
  await sam.submit(`/tasks/${task}/comments`, { body: "Got the new photos from Dale. @mikey want to pick the hero shot?" });
  assert.equal(count(mikeyId), 1);
  const list = textOf(await mikey.page("/notices"));
  assert.match(list, /Sam Rivers mentioned you on “Swap the truck photos” \(new\) Got the new photos from Dale\. @mikey want to pick the hero shot\?/);
  await sam.submit(`/tasks/${task}/comments`, { body: "Note to self @sam" });
  assert.equal(count(samId), 4, "mentioning yourself isn't news");
});

test("all read at once", async () => {
  const done = await sam.submit("/notices/read-all", {});
  assert.match(done.html, /All marked read\./);
  assert.equal(bell(done.html), "0");
  assert.match(textOf(done.html), /Nothing new/);
});

test("reminders: yours only, fired once when due, again when the due date moves, never for done work", async () => {
  const due = Temporal.Now.plainDateISO("America/New_York").add({ days: 5 });
  const task = unwrap(projects.addTask(t.services.projects, mikeyId, website, { title: "Renew the hosting", dueOn: due.toString() }));
  const set = await mikey.submit(`/tasks/${task.id}/reminders`, { kind: "before", daysBefore: "1", time: "09:00" });
  assert.match(set.html, /Reminder set\./);
  assert.match(textOf(set.html), /Reminders The day before it's due, at 9:00 AM For you\. Fires /);
  assert.match(problemOf((await mikey.post(`/tasks/${task.id}/reminders`, { kind: "at", when: "2020-01-01T09:00" })).headers.get("location")), /That time has passed/);
  assert.doesNotMatch(textOf(await sam.page(`/tasks/${task.id}`)), /The day before it's due/, "a reminder is only its setter's");

  const at = (day: Temporal.PlainDate, time: string) => day.toPlainDateTime(Temporal.PlainTime.from(time)).toZonedDateTime("America/New_York").toInstant().toString();
  const run = (when: string) => notices.fireReminders({ ...t.services.notices, clock: () => when });
  assert.equal(run(at(due.subtract({ days: 1 }), "08:59")), 0);
  assert.equal(run(at(due.subtract({ days: 1 }), "09:00")), 1);
  assert.equal(run(at(due.subtract({ days: 1 }), "09:05")), 0, "once");
  const before = count(mikeyId);
  assert.match(textOf(await mikey.page("/notices")), /Reminder: “Renew the hosting” \(new\) Due /);

  unwrap(projects.updateTask(t.services.projects, mikeyId, task.id, { title: "Renew the hosting", dueOn: due.add({ days: 7 }).toString() }));
  assert.equal(run(at(due.add({ days: 6 }), "09:00")), 1, "the due date moved, so it fires for the new one");
  unwrap(projects.updateTask(t.services.projects, mikeyId, task.id, { title: "Renew the hosting", dueOn: due.add({ days: 14 }).toString() }));
  unwrap(projects.moveTaskStatus(t.services.projects, mikeyId, task.id, "done"));
  assert.equal(run(at(due.add({ days: 13 }), "09:00")), 0, "done work reminds no one");
  assert.equal(count(mikeyId), before + 1);

  const id = t.db.prepare("select id from task_reminder where task_id = ?").get(task.id)?.["id"] as Id;
  assert.match(problemOf((await sam.post(`/reminders/${id}/remove`, {})).headers.get("location")), /doesn’t exist/);
  const removed = await mikey.submit(`/reminders/${id}/remove`, {});
  assert.match(removed.html, /Reminder removed\./);
});

test("a reminder for whoever has the task goes to them when it fires, and anyone who edits tasks sees and may remove it", async () => {
  const due = Temporal.Now.plainDateISO("America/New_York").add({ days: 3 });
  const task = unwrap(projects.addTask(t.services.projects, mikeyId, website, { title: "Send the invoice", dueOn: due.toString() }));
  await mikey.submit(`/tasks/${task.id}/reminders`, { kind: "before", daysBefore: "0", time: "08:00", forWhom: "assignee" });
  assert.match(textOf(await sam.page(`/tasks/${task.id}`)), /The day it's due, at 8:00 AM For whoever has it\. Fires /);
  unwrap(projects.updateTask(t.services.projects, mikeyId, task.id, { title: "Send the invoice", dueOn: due.toString(), assigneeId: samId }));
  const before = count(samId);
  const when = due.toPlainDateTime(Temporal.PlainTime.from("08:00")).toZonedDateTime("America/New_York").toInstant().toString();
  assert.equal(notices.fireReminders({ ...t.services.notices, clock: () => when }), 1);
  assert.equal(count(samId), before + 1, "went to Sam, who has it now");
  assert.match(textOf(await sam.page("/notices")), /Reminder: “Send the invoice”/);
  const id = t.db.prepare("select id from task_reminder where task_id = ?").get(task.id)?.["id"] as Id;
  assert.match((await sam.submit(`/reminders/${id}/remove`, {})).html, /Reminder removed\./);
});

test("reminders marked to keep go to the next of a repeat, moved with the due date; others stay behind", async () => {
  const due = Temporal.Now.plainDateISO("America/New_York").add({ days: 2 });
  const task = unwrap(projects.addTask(t.services.projects, mikeyId, website, { title: "Post the weekly update", dueOn: due.toString() }));
  unwrap(projects.setTaskRepeat(t.services.projects, mikeyId, task.id, { every: "1", unit: "week", from: "due" }));
  await mikey.submit(`/tasks/${task.id}/reminders`, { kind: "before", daysBefore: "1", time: "09:00", carry: "1" });
  const at = due.subtract({ days: 1 }).toPlainDateTime(Temporal.PlainTime.from("15:00")).toString().slice(0, 16);
  await mikey.submit(`/tasks/${task.id}/reminders`, { kind: "at", when: at, forWhom: "assignee", carry: "1" });
  await mikey.submit(`/tasks/${task.id}/reminders`, { kind: "before", daysBefore: "0", time: "07:00" });
  unwrap(projects.moveTaskStatus(t.services.projects, mikeyId, task.id, "done"));
  const next = t.db.prepare("select id from task where previous_id = ?").get(task.id)?.["id"] as Id;
  const carried = t.db.prepare("select days_before, time_of_day, at, for_whom, carry from task_reminder where task_id = ? order by rowid").all(next) as Record<string, unknown>[];
  assert.equal(carried.length, 2, "the one not marked to keep stays behind");
  assert.deepEqual({ ...carried[0] }, { days_before: 1, time_of_day: "09:00", at: null, for_whom: "me", carry: 1 });
  const moved = Temporal.Instant.from(String(carried[1]?.["at"])).toZonedDateTimeISO("America/New_York");
  assert.equal(moved.toPlainDate().toString(), due.add({ weeks: 1 }).subtract({ days: 1 }).toString());
  assert.equal(moved.hour, 15);
  assert.equal(carried[1]?.["for_whom"], "assignee");
  assert.match(textOf(await mikey.page(`/tasks/${next}`)), /Kept on each repeat/);
});

test("emailed notices: only for those who ask, one email per person per run, never twice", async () => {
  assert.match(textOf(await sam.page("/notices")), /Email isn't set up for HQ yet/);
  const on = await sam.submit("/notices/email", { on: "1" });
  assert.match(on.html, /Your notices will be emailed to you\./);
  assert.equal(Number(t.db.prepare("select count(*) as n from notice where user_id = ? and emailed_at is null").get(samId)?.["n"]), 0, "what was already here isn't sent");
  unwrap(projects.addTask(t.services.projects, mikeyId, website, { title: "Check the contact form", assigneeId: samId }));
  unwrap(projects.addTask(t.services.projects, mikeyId, website, { title: "Check the map", assigneeId: samId }));
  const sent: { to: string; subject: string; body: string }[] = [];
  const mail = async (message: { to: string; subject: string; body: string }) => (sent.push(message), true);
  const first = await notices.emailNotices(t.services.notices, mail, { publicUrl: "https://hq.example.com" });
  assert.deepEqual(first, { sent: 1, failed: 0 });
  assert.equal(sent[0]?.to, "sam@example.com");
  assert.equal(sent[0]?.subject, "2 new notices in HQ");
  assert.match(sent[0]?.body ?? "", /Mikey Nichols gave you “Check the contact form”\n  https:\/\/hq\.example\.com\/notices\/[0-9a-f-]{36}/);
  assert.deepEqual(await notices.emailNotices(t.services.notices, mail, { publicUrl: "https://hq.example.com" }), { sent: 0, failed: 0 });
  assert.equal(sent.length, 1, "Mikey didn't ask, and nothing went twice");
});
