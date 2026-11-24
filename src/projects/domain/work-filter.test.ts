import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { dueWindow, EMPTY_FILTER, filterQuery, isEmptyFilter, matchesFilter, readColumns, readFilter, sortWork, type WorkFilter, type WorkRowFacts, type WorkSortFacts } from "./work-filter.ts";

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}` as Id;
const params = (query: string) => (name: string) => new URLSearchParams(query).getAll(name);
const TODAY = "2026-11-24"; // a Tuesday
const me = id(9);

function row(over: Partial<WorkRowFacts> = {}): WorkRowFacts {
  return { projectId: id(1), organizationId: id(2), assigneeId: me, labelIds: [], status: "todo", priority: "normal", dueOn: null, title: "Send the homepage proof", ...over };
}
const passes = (r: WorkRowFacts, f: Partial<WorkFilter>) => matchesFilter(r, { ...EMPTY_FILTER, ...f }, { today: TODAY, viewerId: me });

test("a filter is read from the address, keeping only what it recognises", () => {
  const filter = readFilter(params(`project=${id(1)}&project=none&project=nope&who=me&who=nobody&who=bob&status=doing&status=flying&priority=urgent&due=overdue&due=soon&from=2026-11-01&to=11/30&q=  homepage   proof &show=all&label=${id(3)}&client=${id(2)}`));
  assert.deepEqual(filter, {
    projects: [id(1)],
    noProject: true,
    clients: [id(2)],
    who: ["me", "nobody"],
    labels: [id(3)],
    statuses: ["doing"],
    priorities: ["urgent"],
    due: ["overdue"],
    dueFrom: "2026-11-01",
    dueTo: "",
    words: "homepage proof",
    show: "all",
  });
  assert.equal(readFilter(params("show=sideways")).show, "open");
});

test("the same filter is always the same address, and reads back as itself", () => {
  const filter = readFilter(params(`q=proof&status=todo&who=me&project=${id(1)}&show=done`));
  const query = filterQuery(filter);
  assert.equal(query, `project=${id(1)}&who=me&status=todo&q=proof&show=done`);
  assert.deepEqual(readFilter(params(query)), filter);
  assert.equal(filterQuery(EMPTY_FILTER), "");
  assert.ok(isEmptyFilter(readFilter(params("show=open"))));
});

test("due windows: overdue, today, this week to Sunday, next week, later, none", () => {
  assert.equal(dueWindow(null, TODAY), "none");
  assert.equal(dueWindow("2026-11-23", TODAY), "overdue");
  assert.equal(dueWindow(TODAY, TODAY), "today");
  assert.equal(dueWindow("2026-11-29", TODAY), "this-week");
  assert.equal(dueWindow("2026-11-30", TODAY), "next-week");
  assert.equal(dueWindow("2026-12-06", TODAY), "next-week");
  assert.equal(dueWindow("2026-12-07", TODAY), "later");
});

test("open work by default; done or all when asked", () => {
  assert.equal(passes(row({ status: "done" }), {}), false);
  assert.equal(passes(row({ status: "done" }), { show: "done" }), true);
  assert.equal(passes(row(), { show: "done" }), false);
  assert.equal(passes(row({ status: "done" }), { show: "all" }), true);
});

test("any choice within a field, every field across them", () => {
  const tagged = row({ labelIds: [id(3)], priority: "high", dueOn: "2026-11-26" });
  assert.equal(passes(tagged, { labels: [id(3), id(4)] }), true);
  assert.equal(passes(tagged, { labels: [id(4)] }), false);
  assert.equal(passes(tagged, { labels: [id(3)], priorities: ["urgent"] }), false);
  assert.equal(passes(tagged, { labels: [id(3)], priorities: ["urgent", "high"], due: ["this-week"] }), true);
});

test("projects take 'none' for to-dos; people take 'me' and 'nobody'; clients skip rows without one", () => {
  const todo = row({ projectId: null, organizationId: null });
  assert.equal(passes(todo, { projects: [id(1)] }), false);
  assert.equal(passes(todo, { noProject: true }), true);
  assert.equal(passes(row(), { projects: [id(1)], noProject: true }), true);
  assert.equal(passes(todo, { clients: [id(2)] }), false);
  assert.equal(passes(row(), { who: ["me"] }), true);
  assert.equal(passes(row({ assigneeId: null }), { who: ["nobody"] }), true);
  assert.equal(passes(row({ assigneeId: id(5) }), { who: ["me", id(5)] }), true);
  assert.equal(passes(row({ assigneeId: id(5) }), { who: ["me"] }), false);
});

test("a due range needs a due date inside it; words must all be in the title", () => {
  assert.equal(passes(row({ dueOn: "2026-11-26" }), { dueFrom: "2026-11-25", dueTo: "2026-11-30" }), true);
  assert.equal(passes(row({ dueOn: "2026-12-01" }), { dueTo: "2026-11-30" }), false);
  assert.equal(passes(row(), { dueFrom: "2026-11-25" }), false);
  assert.equal(passes(row(), { words: "HOMEPAGE send" }), true);
  assert.equal(passes(row(), { words: "homepage invoice" }), false);
});

test("overdue never matches a finished task", () => {
  assert.equal(passes(row({ status: "done", dueOn: "2026-11-01" }), { due: ["overdue"], show: "all" }), false);
});

test("columns: the saved choice in table order, or the default", () => {
  assert.deepEqual(readColumns(""), ["project", "who", "status", "priority", "due", "labels"]);
  assert.deepEqual(readColumns("due,client,bogus"), ["client", "due"]);
});

test("sorting puts empty values last either way, and ranks priority and status in their own order", () => {
  const base: WorkSortFacts = { title: "", projectName: "", clientName: "", assigneeName: "", status: "todo", priority: "normal", dueOn: null, labelNames: [], estimateMinutes: null };
  const rows = [
    { ...base, title: "a", dueOn: "2026-11-30", priority: "low" as const, assigneeName: "Sam" },
    { ...base, title: "b", dueOn: null, priority: "urgent" as const },
    { ...base, title: "c", dueOn: "2026-11-25", priority: "high" as const, assigneeName: "Jayanti" },
  ];
  const titles = (sorted: { title: string }[]) => sorted.map((one) => one.title).join("");
  assert.equal(titles(sortWork(rows, "due", "asc")), "cab");
  assert.equal(titles(sortWork(rows, "due", "desc")), "acb");
  assert.equal(titles(sortWork(rows, "priority", "asc")), "bca");
  assert.equal(titles(sortWork(rows, "priority", "desc")), "acb");
  assert.equal(titles(sortWork(rows, "who", "asc")), "cab");
  assert.equal(titles(sortWork(rows, "who", "desc")), "acb");
  assert.equal(titles(sortWork(rows, "title", "desc")), "cba");
});
