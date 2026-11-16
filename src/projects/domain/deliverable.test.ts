import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { decideDeliverable, isClientVisible, newDeliverable, shareDeliverable, unshareDeliverable } from "./deliverable.ts";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}` as Id;

function draft() {
  const made = newDeliverable({ id: id(1), projectId: id(2), fileId: id(3), createdBy: id(4) }, { title: " Home page design ", description: "First pass." });
  assert.ok(made.ok);
  return made.value;
}

test("a deliverable starts as a draft the client cannot see", () => {
  const d = draft();
  assert.equal(d.title, "Home page design");
  assert.equal(d.status, "draft");
  assert.equal(isClientVisible(d), false);
  assert.deepEqual(newDeliverable({ id: id(1), projectId: id(2), fileId: id(3), createdBy: id(4) }, { title: "" }), { ok: false, error: "title-missing" });
});

test("sharing shows it to the client; unsharing hides it again", () => {
  const shared = shareDeliverable(draft(), "2026-11-16T10:00:00.000Z");
  assert.ok(shared.ok);
  assert.equal(isClientVisible(shared.value), true);
  assert.deepEqual(shareDeliverable(shared.value, "t"), { ok: false, error: "already-shared" });
  const hidden = unshareDeliverable(shared.value);
  assert.ok(hidden.ok);
  assert.equal(hidden.value.status, "draft");
  assert.deepEqual(unshareDeliverable(hidden.value), { ok: false, error: "not-shared" });
});

test("the client decides only on a shared deliverable, and must say what to change", () => {
  const shared = shareDeliverable(draft(), "t1");
  assert.ok(shared.ok);
  assert.deepEqual(decideDeliverable(draft(), "approved", null, "t2"), { ok: false, error: "not-awaiting-decision" });
  assert.deepEqual(decideDeliverable(shared.value, "maybe", null, "t2"), { ok: false, error: "invalid-decision" });
  assert.deepEqual(decideDeliverable(shared.value, "changes-requested", "  ", "t2"), { ok: false, error: "note-required" });
  const changes = decideDeliverable(shared.value, "changes-requested", "Bigger logo.", "t2");
  assert.ok(changes.ok);
  assert.deepEqual({ s: changes.value.status, at: changes.value.decidedAt, note: changes.value.decisionNote }, { s: "changes-requested", at: "t2", note: "Bigger logo." });
  const again = shareDeliverable(changes.value, "t3");
  assert.ok(again.ok, "sharing again after changes reopens it");
  assert.equal(again.value.decidedAt, null);
  const approved = decideDeliverable(again.value, "approved", null, "t4");
  assert.ok(approved.ok);
  assert.deepEqual(unshareDeliverable(approved.value), { ok: false, error: "already-approved" });
  assert.deepEqual(decideDeliverable(approved.value, "approved", null, "t5"), { ok: false, error: "not-awaiting-decision" });
});
