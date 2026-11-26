import assert from "node:assert/strict";
import { test } from "node:test";
import { lastTryDeclined, nextTry } from "./autopay.ts";

test("tried the day it's sent, then 3 and 7 days after the first try", () => {
  assert.deepEqual(nextTry([], "2026-12-01"), { now: true });
  const once = [{ triedOn: "2026-12-01", outcome: "declined" as const }];
  assert.deepEqual(nextTry(once, "2026-12-03"), { now: false, why: "wait" });
  assert.deepEqual(nextTry(once, "2026-12-04"), { now: true });
  const twice = [...once, { triedOn: "2026-12-04", outcome: "declined" as const }];
  assert.deepEqual(nextTry(twice, "2026-12-07"), { now: false, why: "wait" });
  assert.deepEqual(nextTry(twice, "2026-12-08"), { now: true });
  const thrice = [...twice, { triedOn: "2026-12-08", outcome: "declined" as const }];
  assert.deepEqual(nextTry(thrice, "2026-12-20"), { now: false, why: "out-of-tries" });
  assert.equal(lastTryDeclined(thrice), true);
  assert.equal(lastTryDeclined(twice), false);
});

test("never again after a try with no clear answer, or once paid", () => {
  assert.deepEqual(nextTry([{ triedOn: "2026-12-01", outcome: "unknown" }], "2026-12-20"), { now: false, why: "unclear" });
  assert.deepEqual(nextTry([{ triedOn: "2026-12-01", outcome: "trying" }], "2026-12-20"), { now: false, why: "unclear" });
  assert.deepEqual(nextTry([{ triedOn: "2026-12-01", outcome: "paid" }], "2026-12-20"), { now: false, why: "paid" });
});
