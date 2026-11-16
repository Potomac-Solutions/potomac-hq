// Builds what every application service needs from one open database: the
// stores, the clock and the activity log. The composition root (src/app.ts),
// the commands in bin/ and the tests all start here, so they are wired the
// same way.
import { sqliteClientStore, sqliteContactStore, sqliteOpportunityStore } from "./crm/adapters.ts";
import type { CrmDeps } from "./crm/index.ts";
import { formatWhenIn, sqliteActivityReader } from "./dashboard/adapters.ts";
import type { RecentActivityDeps } from "./dashboard/index.ts";
import { sqliteExpenseStore, sqliteFinanceStore, sqlitePhaseEstimates, sqliteTimeStore } from "./finance/adapters.ts";
import { applyTaskMove, type FinanceDeps } from "./finance/index.ts";
import { sha256Hex, sqliteBlobStore, sqliteFileRecordStore } from "./files/adapters.ts";
import { sqliteUserStore } from "./identity/adapters.ts";
import type { SessionDeps } from "./identity/index.ts";
import { sqliteNoteStore } from "./notes/adapters.ts";
import type { NotesDeps } from "./notes/index.ts";
import { renderProposalPdf, sqliteProposalStore } from "./proposals/adapters.ts";
import type { ProposalDocument, ProposalsDeps } from "./proposals/index.ts";
import { sqliteBaselineStore, sqliteDeliverableStore, sqliteMilestoneStore, sqlitePhaseStore, sqliteProjectHistory, sqliteProjectStore, sqliteTaskStore } from "./projects/adapters.ts";
import type { ProjectsDeps } from "./projects/index.ts";
import { newId, sqliteActivityLog, sqliteTransact, systemClock, type Database } from "./shared/adapters.ts";
import type { Clock } from "./shared/index.ts";

/** "Due today" and the times people read are worked out here (docs/data-model.md). */
export const BUSINESS_TIME_ZONE = "America/New_York";

export type Services = {
  readonly session: SessionDeps;
  readonly crm: CrmDeps;
  readonly dashboard: RecentActivityDeps;
  readonly projects: ProjectsDeps;
  readonly notes: NotesDeps;
  readonly proposals: ProposalsDeps;
  readonly finance: FinanceDeps;
  readonly renderProposalPdf: (document: ProposalDocument) => Uint8Array<ArrayBuffer>;
  /** Today in the business time zone, YYYY-MM-DD. */
  readonly today: () => string;
  readonly formatWhen: (instant: string) => string;
};

export function createServices(db: Database, options: { readonly clock?: Clock; readonly today?: () => string } = {}): Services {
  const clock = options.clock ?? systemClock;
  const today = options.today ?? (() => Temporal.Instant.from(clock()).toZonedDateTimeISO(BUSINESS_TIME_ZONE).toPlainDate().toString());
  const formatWhen = formatWhenIn(BUSINESS_TIME_ZONE);
  const users = sqliteUserStore(db);
  const session: SessionDeps = { users, activityLog: sqliteActivityLog(db), transact: sqliteTransact(db), clock, newId };
  const projectStore = sqliteProjectStore(db);
  const crm: CrmDeps = {
    ...session,
    clients: sqliteClientStore(db),
    contacts: sqliteContactStore(db),
    opportunities: sqliteOpportunityStore(db),
    projects: projectStore,
  };
  const dashboard: RecentActivityDeps = { users, activity: sqliteActivityReader(db), formatWhen };
  const projects: ProjectsDeps = {
    ...session,
    files: sqliteFileRecordStore(db),
    blobs: sqliteBlobStore(db),
    digest: sha256Hex,
    projects: projectStore,
    phases: sqlitePhaseStore(db),
    milestones: sqliteMilestoneStore(db),
    tasks: sqliteTaskStore(db),
    deliverables: sqliteDeliverableStore(db),
    baselines: sqliteBaselineStore(db),
    history: sqliteProjectHistory(db),
    today,
    formatWhen,
    // Marking a task "working on" starts the timer, in the same transaction.
    onTaskMoved: (actorId, task, from) => applyTaskMove(finance, actorId, task, from),
  };
  const finance: FinanceDeps = { ...projects, opportunities: crm.opportunities, time: sqliteTimeStore(db), expenses: sqliteExpenseStore(db), finance: sqliteFinanceStore(db), phaseEstimates: sqlitePhaseEstimates(db) };
  const notes: NotesDeps = { ...session, notes: sqliteNoteStore(db), formatWhen };
  const proposals: ProposalsDeps = { ...crm, ...projects, proposals: sqliteProposalStore(db) };
  return { session, crm, dashboard, projects, notes, proposals, finance, renderProposalPdf, today, formatWhen };
}
