import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { mayChange, mayUse, newSavedFilter } from "./saved-filter.ts";

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}` as Id;

test("a saved filter needs a name and a real filter, and keeps only filter fields, in order", () => {
  assert.deepEqual(newSavedFilter(id(1), id(2), { name: " ", query: "status=todo" }), { ok: false, error: "name-missing" });
  assert.deepEqual(newSavedFilter(id(1), id(2), { name: "x".repeat(61), query: "status=todo" }), { ok: false, error: "name-too-long" });
  assert.deepEqual(newSavedFilter(id(1), id(2), { name: "Nothing", query: "sort=due&evil=1" }), { ok: false, error: "filter-empty" });
  assert.deepEqual(newSavedFilter(id(1), id(2), { name: " Overdue for me ", query: "q=proof&due=overdue&who=me&sort=due", pinned: true }), {
    ok: true,
    value: { id: id(1), ownerId: id(2), name: "Overdue for me", query: "who=me&due=overdue&q=proof", shared: false, pinned: true },
  });
});

test("only its owner changes it; everyone uses it once it is shared", () => {
  const made = newSavedFilter(id(1), id(2), { name: "Mine", query: "who=me" });
  assert.ok(made.ok);
  assert.equal(mayChange(made.value, id(2)), true);
  assert.equal(mayChange(made.value, id(3)), false);
  assert.equal(mayUse(made.value, id(3)), false);
  assert.equal(mayUse({ ...made.value, shared: true }, id(3)), true);
});
