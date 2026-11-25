import type { MonthFacts, MonthlyReport } from "../domain/report.ts";
import type { Id } from "../../shared/index.ts";

export type ReportStore = {
  get(id: Id): MonthlyReport | null;
  forMonth(organizationId: Id, month: string): MonthlyReport | null;
  /** A month's reports. */
  listMonth(month: string): MonthlyReport[];
  /** Every draft, oldest month first. */
  drafts(): MonthlyReport[];
  /** A client's sent reports, newest first. */
  sentFor(organizationId: Id): MonthlyReport[];
  insert(report: MonthlyReport, at: string): void;
  save(report: MonthlyReport, sentBy: Id | null, at: string): void;
};

/** What HQ's records say about a client's month: `from` and `to` bound it; `today` to `horizon` is what's coming. */
export type FactsReader = (organizationId: Id, window: { readonly from: string; readonly to: string; readonly today: string; readonly horizon: string }) => MonthFacts;
