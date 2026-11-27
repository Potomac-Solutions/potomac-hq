import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { changeProjectOwner, changeProjectStatus, companyProject, editProject, isCompanyProject, projectFromWon } from "./project.ts";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}` as Id;
const won = { id: id(1), organizationId: id(2), ownerId: id(3), title: "Bakery website", stage: "won", pricing: "fixed" };

test("a won opportunity becomes an active project named after it", () => {
  assert.deepEqual(projectFromWon(id(9), won), {
    ok: true,
    value: { id: id(9), organizationId: id(2), opportunityId: id(1), ownerId: id(3), name: "Bakery website", kind: "fixed", status: "active", description: "", health: "on-track", startOn: null, targetOn: null },
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

test("details are edited by hand, with dates in order", () => {
  const made = projectFromWon(id(9), won);
  assert.ok(made.ok);
  const edited = editProject(made.value, { name: " Bakery site ", description: "Menu first.", health: "at-risk", startOn: "2026-12-01", targetOn: "2027-01-15" });
  assert.ok(edited.ok);
  assert.deepEqual(
    { name: edited.value.name, description: edited.value.description, health: edited.value.health, startOn: edited.value.startOn, targetOn: edited.value.targetOn },
    { name: "Bakery site", description: "Menu first.", health: "at-risk", startOn: "2026-12-01", targetOn: "2027-01-15" },
  );
  assert.equal(edited.value.status, "active", "status is not changed by an edit");
  assert.deepEqual(editProject(made.value, { name: "", health: "on-track" }), { ok: false, error: "name-missing" });
  assert.deepEqual(editProject(made.value, { name: "x", health: "great" }), { ok: false, error: "invalid-health" });
  assert.deepEqual(editProject(made.value, { name: "x", health: "on-track", startOn: "2026-02-30" }), { ok: false, error: "invalid-date" });
  assert.deepEqual(editProject(made.value, { name: "x", health: "on-track", startOn: "2026-12-02", targetOn: "2026-12-01" }), { ok: false, error: "target-before-start" });
});

test("a new owner must be a different person", () => {
  const made = projectFromWon(id(9), won);
  assert.ok(made.ok);
  assert.deepEqual(changeProjectOwner(made.value, id(3)), { ok: false, error: "unchanged" });
  const moved = changeProjectOwner(made.value, id(4));
  assert.ok(moved.ok);
  assert.equal(moved.value.ownerId, id(4));
});

test("a company project has no client and no opportunity, and checks what's typed (decision 0021)", () => {
  const made = companyProject({ id: id(9), ownerId: id(3) }, { name: "  Training  ", kind: "ongoing", description: "Certificates." });
  assert.deepEqual(made, {
    ok: true,
    value: { id: id(9), organizationId: null, opportunityId: null, ownerId: id(3), name: "Training", kind: "ongoing", status: "active", description: "Certificates.", health: "on-track", startOn: null, targetOn: null },
  });
  assert.equal(made.ok && isCompanyProject(made.value), true);
  assert.deepEqual(companyProject({ id: id(9), ownerId: id(3) }, { name: "", kind: "fixed" }), { ok: false, error: "name-missing" });
  assert.deepEqual(companyProject({ id: id(9), ownerId: id(3) }, { name: "x".repeat(201), kind: "fixed" }), { ok: false, error: "name-too-long" });
  assert.deepEqual(companyProject({ id: id(9), ownerId: id(3) }, { name: "Website", kind: "monthly" }), { ok: false, error: "invalid-kind" });
  // An ongoing one is never completed, as with a client's plan.
  assert.deepEqual(made.ok && changeProjectStatus(made.value, "completed"), { ok: false, error: "ongoing-never-completes" });
});
