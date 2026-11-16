// What was agreed for a project: the accepted proposal's price, hours and
// lines (roadmap v0.4). Time and cost are measured against it from v0.5.
import type { Id } from "../../shared/domain/id.ts";
import type { Money } from "../../shared/domain/money.ts";

export type BaselineLine = {
  readonly item: string;
  readonly kind: string;
  /** Hours or units, in hundredths. */
  readonly quantity: number;
  readonly rate: Money;
  readonly total: Money;
};

export type Baseline = {
  readonly projectId: Id;
  readonly proposalId: Id;
  readonly version: number;
  readonly pricing: string;
  /** The total for fixed and recurring work, per period when recurring. */
  readonly amount: Money;
  /** The hours lines added up, in minutes. */
  readonly minutes: number;
  readonly lines: readonly BaselineLine[];
};
