import assert from "node:assert/strict";
import { test } from "node:test";
import { parseId } from "./id.ts";

test("a lower-case UUID is an id", () => {
  const result = parseId("0193a5f2-7c3e-7b1a-9f4e-2d6c8a1b3e5f");
  assert.equal(result.ok, true);
});

test("anything else is refused with a code", () => {
  for (const text of ["", "42", "0193A5F2-7C3E-7B1A-9F4E-2D6C8A1B3E5F", " 0193a5f2-7c3e-7b1a-9f4e-2d6c8a1b3e5f", "0193a5f2-7c3e-7b1a-9f4e-2d6c8a1b3e5f; drop table"]) {
    assert.deepEqual(parseId(text), { ok: false, error: "invalid-id" }, JSON.stringify(text));
  }
});
