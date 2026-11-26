import assert from "node:assert/strict";
import { test } from "node:test";
import { readRequest, standing } from "./request.ts";

test("a request needs a short title; details are optional and capped", () => {
  assert.deepEqual(readRequest({ title: "  Change   our hours " }), { ok: true, value: { title: "Change our hours", details: "" } });
  assert.deepEqual(readRequest({ title: " " }), { ok: false, error: "title-missing" });
  assert.deepEqual(readRequest({ title: "x".repeat(121) }), { ok: false, error: "title-too-long" });
  assert.deepEqual(readRequest({ title: "x", details: "y".repeat(2001) }), { ok: false, error: "details-too-long" });
});

test("where it stands follows the task, and saying no wins", () => {
  assert.equal(standing({ declinedAt: null }, "todo"), "received");
  assert.equal(standing({ declinedAt: null }, "doing"), "working");
  assert.equal(standing({ declinedAt: null }, "blocked"), "waiting");
  assert.equal(standing({ declinedAt: null }, "done"), "done");
  assert.equal(standing({ declinedAt: null }, null), "received");
  assert.equal(standing({ declinedAt: "2026-11-26T10:00:00Z" }, "doing"), "not-going-ahead");
});
