// The pipeline report's sums (roadmap v1.0): what is open at each stage, how
// much of what closed was won, and where leads come from.
import { LEAD_SOURCES, STAGES, type LeadSource, type Opportunity, type Stage } from "./opportunity.ts";

export type PipelineNumbers = {
  /** Open stages in order, with how many are there and the fixed-price quotes added up. */
  readonly stages: readonly { readonly stage: Stage; readonly count: number; readonly fixedMinor: number }[];
  readonly open: number;
  /** Closed on or after `since`. */
  readonly won: number;
  readonly lost: number;
  /** Whole percent of closed ones that were won, or null when nothing closed. */
  readonly winRate: number | null;
  /** Fixed-price quotes won in the period, added up. */
  readonly wonFixedMinor: number;
  /** Every lead source that has an opportunity: how many ever, and how many won. */
  readonly sources: readonly { readonly source: LeadSource; readonly count: number; readonly won: number }[];
};

const fixed = (o: Opportunity) => (o.pricing === "fixed" && o.value ? o.value.minor : 0);

/** `since` is a UTC instant. A close before it is not counted as won or lost. */
export function pipelineNumbers(opportunities: readonly Opportunity[], since: string): PipelineNumbers {
  const openStages = STAGES.filter((stage) => stage !== "won" && stage !== "lost");
  const stages = openStages.map((stage) => {
    const here = opportunities.filter((o) => o.stage === stage);
    return { stage, count: here.length, fixedMinor: here.reduce((sum, o) => sum + fixed(o), 0) };
  });
  const closed = opportunities.filter((o) => o.closedAt !== null && o.closedAt >= since);
  const wonOnes = closed.filter((o) => o.stage === "won");
  const lost = closed.filter((o) => o.stage === "lost").length;
  const decided = wonOnes.length + lost;
  return {
    stages,
    open: stages.reduce((sum, stage) => sum + stage.count, 0),
    won: wonOnes.length,
    lost,
    winRate: decided === 0 ? null : Math.round((wonOnes.length / decided) * 100),
    wonFixedMinor: wonOnes.reduce((sum, o) => sum + fixed(o), 0),
    sources: LEAD_SOURCES.map((source) => {
      const from = opportunities.filter((o) => o.leadSource === source);
      return { source, count: from.length, won: from.filter((o) => o.stage === "won").length };
    }).filter((row) => row.count > 0),
  };
}
