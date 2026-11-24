import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { byLabelName, colourFor, editLabel, LABEL_COLOURS, LABEL_NAME_MAX, labelChanges, labelKey, newLabel } from "./label.ts";

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}` as Id;

test("a label needs a name of at most forty characters, tidied", () => {
  assert.deepEqual(newLabel(id(1), { name: "   " }), { ok: false, error: "name-missing" });
  assert.deepEqual(newLabel(id(1), { name: "x".repeat(LABEL_NAME_MAX + 1) }), { ok: false, error: "name-too-long" });
  const made = newLabel(id(1), { name: "  client   work ", colour: "teal" });
  assert.deepEqual(made, { ok: true, value: { id: id(1), name: "client work", colour: "teal" } });
});

test("a colour must be one of the twelve; none picks one from the name, the same each time", () => {
  assert.deepEqual(newLabel(id(1), { name: "Website", colour: "hotpink" }), { ok: false, error: "invalid-colour" });
  const a = newLabel(id(1), { name: "Website" });
  const b = newLabel(id(2), { name: " website ", colour: "" });
  assert.ok(a.ok && b.ok);
  assert.equal(a.value.colour, b.value.colour);
  assert.ok((LABEL_COLOURS as readonly string[]).includes(a.value.colour));
  assert.equal(colourFor("Website"), a.value.colour);
});

test("names are one label whatever their capitals and spaces", () => {
  assert.equal(labelKey(" Client  Work"), labelKey("client work"));
  assert.notEqual(labelKey("client work"), labelKey("client-work"));
});

test("editing renames and recolours; an empty colour keeps the one it has", () => {
  const made = newLabel(id(1), { name: "Website", colour: "blue" });
  assert.ok(made.ok);
  assert.deepEqual(editLabel(made.value, { name: "Websites", colour: "" }), { ok: true, value: { id: id(1), name: "Websites", colour: "blue" } });
  assert.deepEqual(editLabel(made.value, { name: "Websites", colour: "red" }), { ok: true, value: { id: id(1), name: "Websites", colour: "red" } });
  assert.deepEqual(editLabel(made.value, { name: "" }), { ok: false, error: "name-missing" });
});

test("a task's label change is what was added and what was taken off", () => {
  assert.deepEqual(labelChanges([id(1), id(2)], [id(2), id(3), id(3)]), { added: [id(3)], removed: [id(1)] });
  assert.deepEqual(labelChanges([], []), { added: [], removed: [] });
});

test("labels sort by name, ignoring capitals", () => {
  assert.deepEqual([{ name: "b" }, { name: "A" }, { name: "c" }].sort(byLabelName), [{ name: "A" }, { name: "b" }, { name: "c" }]);
});
