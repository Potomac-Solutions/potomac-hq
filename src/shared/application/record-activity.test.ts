import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivityEvent } from "../domain/activity.ts";
import type { Id } from "../domain/id.ts";
import { InvalidActivityError, recordActivity, type ActivityDeps } from "./record-activity.ts";

const record = "22222222-2222-4222-8222-222222222222" as Id;

function deps(): ActivityDeps & { events: ActivityEvent[] } {
  const events: ActivityEvent[] = [];
  let n = 0;
  return {
    events,
    activityLog: { append: (event) => void events.push(event) },
    clock: () => "2026-11-14T12:00:00Z",
    newId: () => `00000000-0000-4000-8000-00000000000${++n}` as Id,
  };
}

test("stamps the event with a new id and the clock's time, then appends it", () => {
  const d = deps();
  const event = recordActivity(d, { actorId: null, action: "backup.completed", recordType: "backup", recordId: record });
  assert.equal(event.id, "00000000-0000-4000-8000-000000000001");
  assert.equal(event.occurredAt, "2026-11-14T12:00:00Z");
  assert.deepEqual(d.events, [event]);
});

test("a refused draft throws and appends nothing", () => {
  const d = deps();
  assert.throws(
    () => recordActivity(d, { actorId: null, action: "user.created", recordType: "user", recordId: record, context: { password: "x" } }),
    (error) => error instanceof InvalidActivityError && error.code === "sensitive-context",
  );
  assert.deepEqual(d.events, []);
});
