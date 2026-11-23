import assert from "node:assert/strict";
import { test } from "node:test";
import { decideChange, newChangeRequest, sendChange, withdrawChange } from "./change-request.ts";
import type { Id } from "../../shared/domain/id.ts";

const ids = { id: "1" as Id, projectId: "2" as Id, number: 1, createdBy: "3" as Id };

test("a change has a title, a price (zero is free) and maybe hours", () => {
  assert.deepEqual(newChangeRequest(ids, { title: " ", amount: "100" }), { ok: false, error: "title-missing" });
  assert.deepEqual(newChangeRequest(ids, { title: "Gift cards", amount: "-5" }), { ok: false, error: "not-an-amount" });
  assert.deepEqual(newChangeRequest(ids, { title: "Gift cards", amount: "400", hours: "lots" }), { ok: false, error: "invalid-hours" });
  const made = newChangeRequest(ids, { title: "Gift cards", amount: "400", hours: "8" });
  assert.ok(made.ok);
  assert.deepEqual([made.value.amount.minor, made.value.minutes, made.value.status], [40000, 480, "draft"]);
  const free = newChangeRequest(ids, { title: "Swap the photo", amount: "" });
  assert.equal(free.ok && free.value.amount.minor, 0);
});

test("draft, sent, then answered once; withdrawn only before an answer", () => {
  const made = newChangeRequest(ids, { title: "Gift cards", amount: "400" });
  assert.ok(made.ok);
  assert.deepEqual(decideChange(made.value, "approve", null, { clientUserId: "9" as Id }, "t"), { ok: false, error: "not-waiting" }, "a draft can't be answered");
  const sent = sendChange(made.value, "2026-11-23T00:00:00Z");
  assert.ok(sent.ok);
  assert.deepEqual(sendChange(sent.value, "t"), { ok: false, error: "already-sent" });
  const approved = decideChange(sent.value, "approve", " Yes please ", { clientUserId: "9" as Id }, "2026-11-24T00:00:00Z");
  assert.ok(approved.ok);
  assert.deepEqual([approved.value.status, approved.value.decisionNote], ["approved", "Yes please"]);
  assert.deepEqual(decideChange(approved.value, "decline", null, { clientUserId: "9" as Id }, "t"), { ok: false, error: "not-waiting" });
  assert.deepEqual(withdrawChange(approved.value), { ok: false, error: "already-answered" });
  assert.equal(withdrawChange(sent.value).ok, true);
});
