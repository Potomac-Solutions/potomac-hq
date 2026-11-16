import assert from "node:assert/strict";
import { test } from "node:test";
import { auditQuery, contextLine, dayAfter, pageCount } from "./audit.ts";

test("filters that are not valid are dropped, never an error", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(auditQuery({ actor: id, recordType: "invoice", action: "Invoice.", from: "2026-11-01", to: "2026-11-30", page: "3" }), { actor: id, recordType: "invoice", action: "invoice.", from: "2026-11-01", to: "2026-11-30", page: 3 });
  assert.deepEqual(auditQuery({ actor: "' or 1=1", recordType: "a b", action: "%", from: "2026-02-30", to: "tomorrow", page: "0" }), { actor: "", recordType: "", action: "", from: "", to: "", page: 1 });
  assert.equal(auditQuery({ actor: "none" }).actor, "none");
  assert.deepEqual(auditQuery({}), { actor: "", recordType: "", action: "", from: "", to: "", page: 1 });
});

test("days and pages", () => {
  assert.equal(dayAfter("2026-12-31"), "2027-01-01");
  assert.equal(dayAfter("2028-02-28"), "2028-02-29");
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(50), 1);
  assert.equal(pageCount(51), 2);
});

test("an event's context reads as one line", () => {
  assert.equal(contextLine('{"from":["manager"],"to":["member"],"projectId":"p1"}'), 'from: ["manager"] · to: ["member"] · projectId: p1');
  assert.equal(contextLine("{}"), "");
  assert.equal(contextLine("not json"), "");
  assert.equal(contextLine(JSON.stringify({ note: "x".repeat(200) })).length, "note: ".length + 80);
});
