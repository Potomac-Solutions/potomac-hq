import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { changeProjectStatus, projectFromWon } from "./project.ts";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}` as Id;
const won = { id: id(1), organizationId: id(2), ownerId: id(3), title: "Bakery website", stage: "won", pricing: "fixed" };

test("a won opportunity becomes an active project named after it", () => {
  assert.deepEqual(projectFromWon(id(9), won), {
    ok: true,
    value: { id: id(9), organizationId: id(2), opportunityId: id(1), ownerId: id(3), name: "Bakery website", kind: "fixed", status: "active" },
  });
});

test("monthly and yearly plans become ongoing projects", () => {
  for (const pricing of ["monthly", "yearly"]) {
    const made = projectFromWon(id(9), { ...won, pricing });
    assert.ok(made.ok);
    assert.equal(made.value.kind, "ongoing", pricing);
  }
  for (const pricing of ["free", "hourly", "fixed"]) {
    const made = projectFromWon(id(9), { ...won, pricing });
    assert.ok(made.ok);
    assert.equal(made.value.kind, "fixed", pricing);
  }
});

test("only a won opportunity becomes a project", () => {
  for (const stage of ["new", "quoted", "lost"]) {
    assert.deepEqual(projectFromWon(id(9), { ...won, stage }), { ok: false, error: "not-won" }, stage);
  }
});

test("a fixed project completes or is cancelled, an ongoing one is only cancelled, and both are final", () => {
  const fixed = projectFromWon(id(9), won);
  const ongoing = projectFromWon(id(9), { ...won, pricing: "monthly" });
  assert.ok(fixed.ok && ongoing.ok);
  const done = changeProjectStatus(fixed.value, "completed");
  assert.ok(done.ok);
  assert.deepEqual(changeProjectStatus(done.value, "active"), { ok: false, error: "final" });
  assert.deepEqual(changeProjectStatus(ongoing.value, "completed"), { ok: false, error: "ongoing-never-completes" });
  assert.equal(changeProjectStatus(ongoing.value, "cancelled").ok, true);
  assert.deepEqual(changeProjectStatus(fixed.value, "paused"), { ok: false, error: "invalid-status" });
});
