import assert from "node:assert/strict";
import { test } from "node:test";
import { headline, orderAgenda, type AgendaItem } from "./agenda.ts";

const item = (key: string, kind: AgendaItem["kind"], at: string, overdue = false): AgendaItem => ({ key, kind, text: key, detail: "", href: "", action: "", overdue, at, todoId: "" });

test("calls first by time, then waiting, sites, overdue oldest first, then today's by kind", () => {
  const ordered = orderAgenda([
    item("renewal", "renewal", "2026-11-25"),
    item("todo today", "todo", "2026-11-22"),
    item("old follow-up", "follow-up", "2026-11-10", true),
    item("late todo", "todo", "2026-11-20", true),
    item("follow-up today", "follow-up", "2026-11-22"),
    item("site", "site", ""),
    item("3pm call", "call", "2026-11-22T20:00:00Z"),
    item("waiting", "waiting", ""),
    item("10am call", "call", "2026-11-22T15:00:00Z"),
  ]);
  assert.deepEqual(ordered.map((one) => one.key), ["10am call", "3pm call", "waiting", "site", "old follow-up", "late todo", "follow-up today", "todo today", "renewal"]);
});

test("the headline counts what is due, calls and overdue", () => {
  assert.equal(headline([]), "Nothing due today. A good day to find new work.");
  assert.equal(headline([item("a", "call", ""), item("b", "todo", "", true)]), "2 things today, 1 call booked, 1 overdue.");
  assert.equal(headline([item("a", "todo", "")]), "1 thing today.");
});
