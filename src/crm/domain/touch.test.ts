import assert from "node:assert/strict";
import { test } from "node:test";
import { newTouch, touchLabel } from "./touch.ts";
import type { Id } from "../../shared/domain/id.ts";

const ids = { id: "1" as Id, organizationId: "2" as Id, opportunityId: null, contactId: null, userId: "3" as Id, happenedAt: "2026-11-23T15:00:00Z" };

test("a call keeps its outcome; other kinds have none", () => {
  const vm = newTouch(ids, { kind: "call", outcome: "voicemail" });
  assert.ok(vm.ok);
  assert.equal(vm.value.outcome, "voicemail");
  assert.equal(touchLabel(vm.value), "Call, left a voicemail");
  const email = newTouch(ids, { kind: "email", outcome: "voicemail", note: "Sent the mock-up" });
  assert.ok(email.ok);
  assert.equal(email.value.outcome, null);
  assert.equal(touchLabel(email.value), "Email");
  const talked = newTouch(ids, { kind: "call", note: "Wants a quote by Friday" });
  assert.equal(talked.ok && talked.value.outcome, "reached", "a call with no outcome given was a conversation");
});

test("a conversation needs a word about it; a missed call does not", () => {
  assert.deepEqual(newTouch(ids, { kind: "call", outcome: "reached" }), { ok: false, error: "note-missing" });
  assert.deepEqual(newTouch(ids, { kind: "meeting" }), { ok: false, error: "note-missing" });
  assert.equal(newTouch(ids, { kind: "call", outcome: "no-answer" }).ok, true);
  assert.deepEqual(newTouch(ids, { kind: "fax", note: "x" }), { ok: false, error: "invalid-kind" });
  assert.deepEqual(newTouch(ids, { kind: "call", outcome: "busy" }), { ok: false, error: "invalid-outcome" });
});
