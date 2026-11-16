import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import type { Opportunity } from "./opportunity.ts";
import { pipelineNumbers } from "./pipeline-report.ts";

let n = 0;
const one = (change: Partial<Opportunity>): Opportunity => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` as Id,
  organizationId: "11111111-1111-4111-8111-111111111111" as Id,
  contactId: null,
  ownerId: "22222222-2222-4222-8222-222222222222" as Id,
  title: "T",
  service: null,
  stage: "new",
  pricing: null,
  value: null,
  leadSource: "phone",
  followUpOn: null,
  summary: "",
  lostReason: null,
  closedAt: null,
  ...change,
});
const usd = (minor: number) => ({ minor, currency: "USD" as const });

test("open work by stage, the win rate of what closed in the period, and lead sources", () => {
  const numbers = pipelineNumbers(
    [
      one({ stage: "new" }),
      one({ stage: "quoted", pricing: "fixed", value: usd(150000) }),
      one({ stage: "quoted", pricing: "hourly", value: usd(7500) }),
      one({ stage: "won", pricing: "fixed", value: usd(240000), closedAt: "2026-11-01T00:00:00Z", leadSource: "referral" }),
      one({ stage: "won", pricing: "monthly", value: usd(5000), closedAt: "2026-10-20T00:00:00Z", leadSource: "referral" }),
      one({ stage: "lost", closedAt: "2026-10-05T00:00:00Z", leadSource: "website" }),
      one({ stage: "won", pricing: "fixed", value: usd(99900), closedAt: "2026-01-01T00:00:00Z" }),
    ],
    "2026-08-18T00:00:00Z",
  );
  assert.deepEqual(numbers.stages, [
    { stage: "new", count: 1, fixedMinor: 0 },
    { stage: "consult-booked", count: 0, fixedMinor: 0 },
    { stage: "consulted", count: 0, fixedMinor: 0 },
    { stage: "quoted", count: 2, fixedMinor: 150000 },
  ]);
  assert.deepEqual([numbers.open, numbers.won, numbers.lost, numbers.winRate, numbers.wonFixedMinor], [3, 2, 1, 67, 240000]);
  assert.deepEqual(numbers.sources, [
    { source: "phone", count: 4, won: 1 },
    { source: "website", count: 1, won: 0 },
    { source: "referral", count: 2, won: 2 },
  ]);
});

test("with nothing closed there is no win rate", () => {
  const numbers = pipelineNumbers([one({})], "2026-01-01T00:00:00Z");
  assert.equal(numbers.winRate, null);
  assert.deepEqual(pipelineNumbers([], "2026-01-01T00:00:00Z").sources, []);
});
