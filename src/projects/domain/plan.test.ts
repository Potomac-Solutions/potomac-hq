import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { completeMilestone, isMilestoneOverdue, milestoneProgress, newMilestone, newPhase, nextMilestone, reopenMilestone, type Milestone } from "./plan.ts";

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}` as Id;
const project = id(1);
const milestone = (n: number, name: string, dueOn: string | null, doneOn: string | null = null): Milestone => ({ id: id(n), projectId: project, phaseId: null, name, dueOn, doneOn, forClient: false });

test("a phase goes after the ones already there", () => {
  assert.deepEqual(newPhase(id(2), project, 0, { name: " Design " }), { ok: true, value: { id: id(2), projectId: project, name: "Design", position: 0 } });
  assert.deepEqual(newPhase(id(3), project, 2, { name: "Build" }), { ok: true, value: { id: id(3), projectId: project, name: "Build", position: 2 } });
  assert.deepEqual(newPhase(id(3), project, 0, { name: " " }), { ok: false, error: "name-missing" });
});

test("a milestone has a name and may have a due date", () => {
  assert.deepEqual(newMilestone(id(2), project, { name: "Design signed off", dueOn: "2026-12-05" }), { ok: true, value: milestone(2, "Design signed off", "2026-12-05") });
  assert.deepEqual(newMilestone(id(2), project, { name: "Launch", dueOn: "" }), { ok: true, value: milestone(2, "Launch", null) });
  assert.deepEqual(newMilestone(id(2), project, { name: "Launch", dueOn: "12/05/2026" }), { ok: false, error: "invalid-date" });
});

test("the next milestone is the open one due soonest, undated ones last", () => {
  const list = [milestone(2, "Launch", null), milestone(3, "Build done", "2026-12-20"), milestone(4, "Design signed off", "2026-12-05"), milestone(5, "Kickoff", "2026-11-20", "2026-11-20")];
  assert.equal(nextMilestone(list)?.name, "Design signed off");
  assert.equal(nextMilestone([milestone(2, "Launch", null), milestone(5, "Kickoff", "2026-11-20", "2026-11-20")])?.name, "Launch");
  assert.equal(nextMilestone([milestone(5, "Kickoff", "2026-11-20", "2026-11-20")]), null);
  assert.equal(nextMilestone([]), null);
  assert.deepEqual(milestoneProgress(list), { done: 1, total: 4 });
});

test("a milestone is completed once, and can be reopened", () => {
  const done = completeMilestone(milestone(2, "Launch", "2026-12-01"), "2026-12-02");
  assert.ok(done.ok);
  assert.equal(done.value.doneOn, "2026-12-02");
  assert.deepEqual(completeMilestone(done.value, "2026-12-03"), { ok: false, error: "already-done" });
  const reopened = reopenMilestone(done.value);
  assert.ok(reopened.ok);
  assert.equal(reopened.value.doneOn, null);
  assert.deepEqual(reopenMilestone(reopened.value), { ok: false, error: "not-done" });
});

test("only an open milestone past its date is overdue", () => {
  assert.equal(isMilestoneOverdue(milestone(2, "a", "2026-12-01"), "2026-12-02"), true);
  assert.equal(isMilestoneOverdue(milestone(2, "a", "2026-12-01"), "2026-12-01"), false);
  assert.equal(isMilestoneOverdue(milestone(2, "a", "2026-12-01", "2026-12-05"), "2026-12-09"), false);
  assert.equal(isMilestoneOverdue(milestone(2, "a", null), "2026-12-09"), false);
});
