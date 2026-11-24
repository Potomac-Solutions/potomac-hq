import assert from "node:assert/strict";
import { test } from "node:test";
import { keyFromName, readKey, readRef, refsIn, taskRef } from "./task-key.ts";

test("a key from a project's name: initials, or a single word's first letters; a taken one gets a digit", () => {
  const none = new Set<string>();
  assert.equal(keyFromName("Better Days website", none), "BDW");
  assert.equal(keyFromName("Tailgate", none), "TAI");
  assert.equal(keyFromName("Mt. Storm Bakery: menu & site", none), "MSBMS");
  assert.equal(keyFromName("Café Olé", none), "CO");
  assert.equal(keyFromName("7 Day Plan", none), "P7DP");
  assert.equal(keyFromName("X", none), "XX");
  assert.equal(keyFromName("日本の店", none), "PRJ");
  assert.equal(keyFromName("Better Days website", new Set(["BDW"])), "BDW2");
  assert.equal(keyFromName("Better Days website", new Set(["BDW", "BDW2"])), "BDW3");
  assert.equal(keyFromName("Total Old Digital Ops", none), "TODO2", "TODO is to-dos'");
  assert.equal(keyFromName("Inventory", none), "INV2", "INV-0003 is an invoice");
  assert.equal(keyFromName("Mt. Storm Bakery: menu & site", new Set(["MSBMS"])), "MSBMS2");
});

test("keys people type, refs, and refs in text", () => {
  assert.deepEqual(readKey(" bdw "), { ok: true, value: "BDW" });
  for (const bad of ["B", "TOOLONGX", "1AB", "B-D", "todo", "inv"]) assert.deepEqual(readKey(bad), { ok: false, error: "invalid-key" }, bad);
  assert.equal(taskRef("BDW", 12), "BDW-12");
  assert.equal(taskRef(null, 12), "");
  assert.deepEqual(readRef(" bdw-12 "), { key: "BDW", number: 12 });
  assert.equal(readRef("BDW 12"), null);
  assert.deepEqual(refsIn("Fixes BDW-12 and BDW-3; see https://x.dev/BDW-9 and see pre-BDW-4, BDW-12 again"), [
    { key: "BDW", number: 12 },
    { key: "BDW", number: 3 },
    { key: "BDW", number: 9 },
  ]);
});
