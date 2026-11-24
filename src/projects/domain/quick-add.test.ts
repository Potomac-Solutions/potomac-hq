import assert from "node:assert/strict";
import { test } from "node:test";
import { handleOf, matchHandle, parseQuickAdd } from "./quick-add.ts";

// Tuesday 24 November 2026.
const TODAY = "2026-11-24";
const due = (text: string) => parseQuickAdd(text, TODAY).parts.find((part) => part.kind === "due");

test("the words that set a field come out of the title", () => {
  const read = parseQuickAdd("Send the homepage proof *website @jayanti !high +better-days tomorrow", TODAY);
  assert.equal(read.title, "Send the homepage proof");
  assert.deepEqual(read.parts, [
    { kind: "label", index: 4, words: "*website", handle: "website", name: "website" },
    { kind: "person", index: 5, words: "@jayanti", handle: "jayanti" },
    { kind: "priority", index: 6, words: "!high", priority: "high" },
    { kind: "project", index: 7, words: "+better-days", handle: "better-days" },
    { kind: "due", index: 8, words: "tomorrow", on: "2026-11-25" },
  ]);
});

test("due dates people type", () => {
  const cases: Record<string, string> = {
    "Call Sam today": "2026-11-24",
    "Call Sam tomorrow": "2026-11-25",
    "Call Sam fri": "2026-11-27",
    "Call Sam Tuesday": "2026-12-01",
    "Call Sam next week": "2026-11-30",
    "Call Sam next fri": "2026-12-04",
    "Call Sam next month": "2026-12-01",
    "Call Sam in 3 days": "2026-11-27",
    "Call Sam in 2 weeks": "2026-12-08",
    "Call Sam dec 5": "2026-12-05",
    "Call Sam December 5th": "2026-12-05",
    "Call Sam jan 3": "2027-01-03",
    "Call Sam 12/5": "2026-12-05",
    "Call Sam 3/1": "2027-03-01",
    "Call Sam 2/28/2028": "2028-02-28",
    "Call Sam 2027-01-15": "2027-01-15",
  };
  for (const [text, on] of Object.entries(cases)) assert.equal(due(text)?.on, on, text);
  assert.equal(parseQuickAdd("Call Sam by fri", TODAY).title, "Call Sam", "a lead-in goes with its date");
  assert.equal(due("Call Sam by fri")?.words, "by fri");
});

test("words that aren't a date stay in the title", () => {
  for (const text of ["Fix feb 30 report", "Fix 13/40 split", "Read in 0 days", "Next steps doc", "Pay the bill on time"]) {
    const read = parseQuickAdd(text, TODAY);
    assert.equal(read.parts.length, 0, text);
    assert.equal(read.title, text);
  }
});

test("only the first of a kind counts, except labels; unknown priorities stay", () => {
  const read = parseQuickAdd("Ship it today fri @sam @jo *a *b *a !high !low !someday every week monthly", TODAY);
  assert.equal(read.title, "Ship it fri @jo *a !low !someday monthly");
  assert.deepEqual(read.parts.map((part) => part.words), ["today", "@sam", "*a", "*b", "!high", "every week"]);
});

test("a removed part goes back into the title, and a later one can take its place", () => {
  const read = parseQuickAdd("Ship it today @sam fri", TODAY, new Set([2]));
  assert.equal(read.title, "Ship it today");
  assert.deepEqual(read.parts.map((part) => [part.kind, part.words]), [["person", "@sam"], ["due", "fri"]]);
});

test("repeats", () => {
  const repeat = (text: string) => parseQuickAdd(text, TODAY).parts.find((part) => part.kind === "repeat");
  assert.deepEqual(repeat("Send the report every week")?.repeat, { every: 1, unit: "week", from: "due" });
  assert.deepEqual(repeat("Check backups every 2 weeks")?.repeat, { every: 2, unit: "week", from: "due" });
  assert.deepEqual(repeat("Mow every other week")?.repeat, { every: 2, unit: "week", from: "due" });
  assert.deepEqual(repeat("Renew the card yearly")?.repeat, { every: 1, unit: "year", from: "due" });
  assert.equal(parseQuickAdd("Invoice monthly fri", TODAY).title, "Invoice");
  for (const text of ["Thank every client", "Every weeks", "every 0 days"]) assert.equal(repeat(text), undefined, text);
});

test("handles, and matching a handle to names", () => {
  assert.equal(handleOf("Better Days Towing"), "better-days-towing");
  assert.equal(handleOf("Café Olé!"), "cafe-ole");
  assert.equal(parseQuickAdd("Note @Sam.", TODAY).parts[0]?.kind, "person");
  const projects = ["Better Days website", "Better Days logo", "Tailgate shop"];
  const names = (name: string) => [name];
  assert.deepEqual(matchHandle("tailgate", projects, names), ["Tailgate shop"]);
  assert.deepEqual(matchHandle("better-days", projects, names), ["Better Days website", "Better Days logo"]);
  assert.deepEqual(matchHandle("better-days-logo", projects, names), ["Better Days logo"]);
  assert.deepEqual(matchHandle("bett", projects, names), [], "a handle matches whole words");
});
