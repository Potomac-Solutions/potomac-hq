import assert from "node:assert/strict";
import { test } from "node:test";
import { readCsv, readTodoist, readTrello, statusFromName } from "./task-import.ts";

const ZONE = "America/New_York";

test("a list's name as a status", () => {
  assert.equal(statusFromName("To Do"), "todo");
  assert.equal(statusFromName("Backlog"), "todo");
  assert.equal(statusFromName("In Progress"), "doing");
  assert.equal(statusFromName("Waiting on client"), "blocked");
  assert.equal(statusFromName("Done ✅"), "done");
});

test("Trello: open cards in open lists, statuses from lists, labels, checklists as subtasks, due dates", () => {
  const board = {
    name: "Better Days website",
    lists: [
      { id: "l1", name: "To do", closed: false },
      { id: "l2", name: "Doing", closed: false },
      { id: "l3", name: "Old ideas", closed: true },
    ],
    labels: [
      { id: "g", name: "Website", color: "green" },
      { id: "y", name: "", color: "yellow" },
      { id: "p", name: "Photos", color: "purple_dark" },
    ],
    cards: [
      { id: "c1", name: "Build the  homepage", desc: "Use the new logo.", idList: "l2", closed: false, due: "2026-12-04T22:00:00.000Z", idLabels: ["g", "y"] },
      { id: "c2", name: "Swap the truck photos", desc: "", idList: "l1", closed: false, due: null, dueComplete: false, idLabels: ["p", "g"] },
      { id: "c3", name: "Send the proof", desc: "", idList: "l1", closed: false, due: "2026-11-20T15:00:00.000Z", dueComplete: true, idLabels: [] },
      { id: "c4", name: "Archived", idList: "l1", closed: true },
      { id: "c5", name: "In an archived list", idList: "l3", closed: false },
    ],
    checklists: [{ id: "k1", idCard: "c1", name: "Sections", checkItems: [{ name: "Hero", state: "complete" }, { name: "Services", state: "incomplete", due: "2026-12-02T17:00:00.000Z" }] }],
  };
  const read = readTrello(JSON.stringify(board), ZONE);
  assert.ok(read.ok);
  const plan = read.value;
  assert.equal(plan.name, "Better Days website");
  assert.deepEqual(plan.tasks.map((task) => [task.title, task.status, task.dueOn]), [["Build the homepage", "doing", "2026-12-04"], ["Swap the truck photos", "todo", null], ["Send the proof", "done", "2026-11-20"]]);
  assert.deepEqual(plan.tasks[0]?.labels, ["Website", "Yellow"]);
  assert.deepEqual(plan.tasks[0]?.subtasks, [{ title: "Hero", done: true, dueOn: null }, { title: "Services", done: false, dueOn: "2026-12-02" }]);
  assert.equal(plan.tasks[0]?.description, "Use the new logo.");
  assert.deepEqual(plan.labels, [{ name: "Photos", colour: "violet" }, { name: "Website", colour: "green" }, { name: "Yellow", colour: "amber" }]);
  assert.deepEqual(plan.skipped, ["1 archived card", "1 card in archived lists"]);
  assert.deepEqual(readTrello("{\"cards\":1}", ZONE), { ok: false, error: "not-trello" });
  assert.deepEqual(readTrello("not json", ZONE), { ok: false, error: "not-trello" });
  assert.deepEqual(readTrello(JSON.stringify({ lists: [], cards: [] }), ZONE), { ok: false, error: "nothing-to-import" });
});

test("CSV: quotes, doubled quotes, commas and line breaks inside fields", () => {
  assert.deepEqual(readCsv('﻿A,B\r\n"one, two","say ""hi""\nthere"\n\n'), [["A", "B"], ["one, two", 'say "hi"\nthere']]);
});

test("Todoist: sections as statuses, @labels, priority 1 highest, indents as subtasks, notes, dates like quick add", () => {
  const csv = [
    "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE",
    "task,Renew the domain @admin,,1,1,Mikey (1),,every year,en,America/New_York",
    "task,Order the yard sign,,4,1,,,dec 5,en,",
    "note,Ask for the matte finish,,,,,,,,",
    "task,Measure the wall,,4,2,,,tomorrow,en,",
    "task,Find a stud finder,,4,3,,,,en,",
    "section,In Progress,,,,,,,,",
    "task,Write the about page @website @copy_edit,Short and warm.,2,1,,,someday maybe,en,",
  ].join("\n");
  const read = readTodoist(csv, "2026-11-24");
  assert.ok(read.ok);
  const [domain, sign, about] = read.value.tasks;
  assert.deepEqual([domain?.title, domain?.priority, domain?.labels, domain?.repeat, domain?.status], ["Renew the domain", "urgent", ["admin"], { every: 1, unit: "year", from: "due" }, "todo"]);
  assert.deepEqual([sign?.priority, sign?.dueOn, sign?.description], ["low", "2026-12-05", "Ask for the matte finish"]);
  assert.deepEqual(sign?.subtasks, [{ title: "Measure the wall", done: false, dueOn: "2026-11-25" }, { title: "Find a stud finder", done: false, dueOn: null }]);
  assert.deepEqual([about?.status, about?.priority, about?.labels, about?.dueOn, about?.from], ["doing", "high", ["website", "copy edit"], null, "In Progress"]);
  assert.deepEqual(read.value.notes, ["1 date couldn't be read, so that task has none.", "1 task indented more than once became subtasks of the task above, as HQ's subtasks go one level deep."]);
  assert.deepEqual(readTodoist("NAME,DUE\nx,y", "2026-11-24"), { ok: false, error: "not-todoist" });
  assert.deepEqual(readTodoist("", "2026-11-24"), { ok: false, error: "file-empty" });
});
