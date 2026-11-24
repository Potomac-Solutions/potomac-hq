import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { delivered, hookEventsFrom, nextTry, readWebhook } from "./webhook.ts";

test("an address: https on the usual port, no sign-in, not inside a network; and at least one event", () => {
  assert.deepEqual(readWebhook({ url: " https://n8n.example.com/webhook/abc#x ", events: ["task.done", "task.added"] }), { ok: true, value: { url: "https://n8n.example.com/webhook/abc", events: ["task.added", "task.done"] } });
  for (const [url, error] of [
    ["http://n8n.example.com/hook", "address-invalid"],
    ["https://user:pass@n8n.example.com/hook", "address-invalid"],
    ["https://n8n.example.com:8443/hook", "address-invalid"],
    ["not a url", "address-invalid"],
    ["https://localhost/hook", "address-private"],
    ["https://n8n.internal/hook", "address-private"],
    ["https://printer.local/hook", "address-private"],
    ["https://intranet/hook", "address-private"],
  ] as const) {
    assert.deepEqual(readWebhook({ url, events: ["task.done"] }), { ok: false, error }, url);
  }
  assert.deepEqual(readWebhook({ url: "https://n8n.example.com/h", events: [] }), { ok: false, error: "events-missing" });
  assert.deepEqual(readWebhook({ url: "https://n8n.example.com/h", events: ["task.deleted"] }), { ok: false, error: "events-missing" });
});

test("which webhook events an activity is", () => {
  const of = (action: string, context: Record<string, unknown> = {}) => hookEventsFrom({ action, recordId: "t" as Id, context }).map((one) => one.event);
  assert.deepEqual(of("task.added", { assigneeId: "u" }), ["task.added", "task.assigned"]);
  assert.deepEqual(of("todo.added", {}), ["task.added"]);
  assert.deepEqual(of("task.edited", { assigneeId: "u", assigneeWas: "v" }), ["task.assigned"]);
  assert.deepEqual(of("task.edited", { assigneeId: "u", assigneeWas: "u" }), []);
  assert.deepEqual(of("task.moved", { from: "doing", to: "done" }), ["task.moved", "task.done"]);
  assert.deepEqual(of("todo.done"), ["task.moved", "task.done"]);
  assert.deepEqual(of("comment.added", { body: "Hi" }), ["task.commented"]);
  assert.deepEqual(of("project.created"), ["project.added"]);
  assert.deepEqual(of("project.status-changed", { to: "completed" }), ["project.completed"]);
  assert.deepEqual(of("project.status-changed", { to: "cancelled" }), []);
  assert.deepEqual(of("label.added"), []);
  const comment = hookEventsFrom({ action: "comment.added", recordId: "t" as Id, context: { body: "Bigger phone number", guestName: "Dale" } })[0];
  assert.deepEqual(comment?.details, { comment: "Bigger phone number", throughShareLink: true, name: "Dale" });
});

test("retries wait longer each time, and stop within a day", () => {
  const first = "2026-11-24T20:00:00Z";
  assert.equal(nextTry(1, first, first), "2026-11-24T20:01:00Z");
  assert.equal(nextTry(4, first, "2026-11-24T20:21:00Z"), "2026-11-24T21:21:00Z");
  assert.equal(nextTry(7, first, "2026-11-25T08:00:00Z"), "2026-11-25T20:00:00Z", "a day on the dot is still within it");
  assert.equal(nextTry(7, first, "2026-11-25T08:01:00Z"), null, "twelve hours more would be past a day");
  assert.equal(nextTry(8, first, first), null);
  assert.equal(delivered(204), true);
  assert.equal(delivered(301), false);
  assert.equal(delivered(500), false);
  assert.equal(delivered(null), false);
});
