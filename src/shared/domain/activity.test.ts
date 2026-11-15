import assert from "node:assert/strict";
import { test } from "node:test";
import { activityEvent, type ActivityDraft, type Context } from "./activity.ts";
import type { Id } from "./id.ts";

const actor = "11111111-1111-4111-8111-111111111111" as Id;
const record = "22222222-2222-4222-8222-222222222222" as Id;
const stamp = { id: "33333333-3333-4333-8333-333333333333" as Id, occurredAt: "2026-11-14T12:00:00Z" };

function draft(over: Partial<ActivityDraft> = {}): ActivityDraft {
  return { actorId: actor, action: "opportunity.stage-changed", recordType: "opportunity", recordId: record, ...over };
}

test("a valid draft becomes an event with the server's id and time", () => {
  const result = activityEvent(draft({ context: { from: "new", to: "consult-booked" } }), stamp);
  assert.deepEqual(result, {
    ok: true,
    value: {
      id: stamp.id,
      occurredAt: stamp.occurredAt,
      actorId: actor,
      action: "opportunity.stage-changed",
      recordType: "opportunity",
      recordId: record,
      context: { from: "new", to: "consult-booked" },
    },
  });
});

test("context defaults to an empty object", () => {
  const result = activityEvent(draft(), stamp);
  assert.ok(result.ok);
  assert.deepEqual(result.value.context, {});
});

test("an event with no actor is allowed, for actions HQ takes itself", () => {
  const result = activityEvent(draft({ actorId: null, action: "backup.completed", recordType: "backup" }), stamp);
  assert.ok(result.ok);
  assert.equal(result.value.actorId, null);
});

test("the action must be a dotted lower-case key", () => {
  for (const action of ["", "opportunity", "Opportunity.created", "opportunity.", ".created", "opportunity created", "opportunity.stage_changed", "opportunity..created"]) {
    assert.deepEqual(activityEvent(draft({ action }), stamp), { ok: false, error: "invalid-action" }, action);
  }
  for (const action of ["user.signed-in", "client.status.changed", "opportunity.converted"]) {
    assert.equal(activityEvent(draft({ action }), stamp).ok, true, action);
  }
});

test("the record type must be one lower-case name", () => {
  for (const recordType of ["", "Opportunity", "client organization", "client.organization"]) {
    assert.deepEqual(activityEvent(draft({ recordType }), stamp), { ok: false, error: "invalid-record-type" }, recordType);
  }
  assert.equal(activityEvent(draft({ recordType: "client-organization" }), stamp).ok, true);
});

test("sensitive values are refused, at any depth", () => {
  const contexts: Context[] = [
    { password: "hunter2" },
    { newPassword: "hunter2" },
    { resetToken: "abc" },
    { session: "abc" },
    { apiKey: "abc" },
    { card_number: "4111" },
    { payment: { cvv: "123" } },
    { changes: [{ field: "x" }, { secret: "y" }] },
    { Authorization: "Bearer abc" },
  ];
  for (const context of contexts) {
    assert.deepEqual(activityEvent(draft({ context }), stamp), { ok: false, error: "sensitive-context" }, JSON.stringify(context));
  }
});

test("ordinary keys that merely resemble sensitive ones are allowed", () => {
  const context: Context = { from: "quoted", to: "won", passed: true, compass: "n", discard: false, className: "x", cardinality: 3 };
  assert.equal(activityEvent(draft({ context }), stamp).ok, true);
});

test("context must be plain JSON data", () => {
  const bad: unknown[] = [
    { when: new Date(0) },
    { amount: Number.NaN },
    { run: () => 1 },
    { big: 10n },
    { missing: undefined },
    { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } },
  ];
  for (const context of bad) {
    assert.deepEqual(activityEvent(draft({ context: context as Context }), stamp), { ok: false, error: "invalid-context" });
  }
});
