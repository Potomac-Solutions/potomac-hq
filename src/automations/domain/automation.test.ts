import assert from "node:assert/strict";
import { test } from "node:test";
import { afterRun, alertFor, automationFields, cleanMessage, isLate, type Automation } from "./automation.ts";
import type { Id } from "../../shared/domain/id.ts";

const base: Automation = { id: "11111111-1111-4111-8111-111111111111" as Id, organizationId: "22222222-2222-4222-8222-222222222222" as Id, name: "Orders to sheet", description: "", n8nUrl: "", everyMinutes: 60, active: true, state: "waiting", lastRunAt: null, lastMessage: "", alerted: "waiting", createdAt: "2026-11-25T12:00:00Z" };

test("an automation needs a name and a schedule from the list; its n8n link is https", () => {
  assert.deepEqual(automationFields({ name: " Orders  to sheet ", description: "Copies orders", n8nUrl: "https://n8n.potomac.solutions/workflow/12", every: "60" }), { ok: true, value: { name: "Orders to sheet", description: "Copies orders", n8nUrl: "https://n8n.potomac.solutions/workflow/12", everyMinutes: 60 } });
  assert.deepEqual(automationFields({ name: "", every: "60" }), { ok: false, error: "name-missing" });
  assert.deepEqual(automationFields({ name: "A", every: "7" }), { ok: false, error: "invalid-schedule" });
  assert.deepEqual(automationFields({ name: "A", every: "60", n8nUrl: "http://n8n.local/x" }), { ok: false, error: "url-invalid" });
});

test("late after its schedule and half again, from the last run or from when it was added", () => {
  assert.equal(isLate(base, "2026-11-25T13:29:00Z"), false);
  assert.equal(isLate(base, "2026-11-25T13:31:00Z"), true);
  assert.equal(isLate({ ...base, lastRunAt: "2026-11-25T13:00:00Z" }, "2026-11-25T14:20:00Z"), false);
  assert.equal(isLate({ ...base, active: false }, "2026-12-25T00:00:00Z"), false, "a paused one is never late");
});

test("each turn for the worse is told once, and so is getting better", () => {
  const failed = afterRun(base, "failed", "Sheet\nnot found", "2026-11-25T13:00:00Z");
  assert.deepEqual([failed.state, failed.lastMessage], ["failed", "Sheet not found"]);
  assert.equal(alertFor(failed), "bad");
  assert.equal(alertFor({ ...failed, alerted: "failed" }), null);
  assert.equal(alertFor({ state: "ok", alerted: "failed" }), "recovered");
  assert.equal(alertFor({ state: "ok", alerted: "waiting" }), null, "a first good run is no news");
  assert.equal(alertFor({ state: "late", alerted: "ok" }), "bad");
  assert.equal(cleanMessage("x".repeat(400)).length, 300);
});
