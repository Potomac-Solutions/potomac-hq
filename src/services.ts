// Builds what every application service needs from one open database: the
// stores, the clock and the activity log. The composition root (src/app.ts),
// the commands in bin/ and the tests all start here, so they are wired the
// same way.
import { sqliteClientStore, sqliteContactStore, sqliteOpportunityStore, sqliteTouchStore } from "./crm/adapters.ts";
import type { CrmDeps, TouchDeps } from "./crm/index.ts";
import { formatWhenIn, sqliteActivityReader, sqliteAuditReader, sqliteSearchReader } from "./dashboard/adapters.ts";
import type { AuditDeps, RecentActivityDeps, SearchDeps } from "./dashboard/index.ts";
import { renderInvoicePdf, sqliteExpenseStore, sqliteFinanceStore, sqliteInvoiceStore, sqlitePhaseEstimates, sqliteRecurringStore, sqliteReminderStore, sqliteTimeStore } from "./finance/adapters.ts";
import { applyDepositDraft, applyTaskMove, type ClientEmails, type FinanceDeps, type InvoiceDocument, type RemindersDeps } from "./finance/index.ts";
import { sha256Hex, sqliteBlobStore, sqliteFileRecordStore } from "./files/adapters.ts";
import type { BookingDeps, BusyCalendar } from "./booking/index.ts";
import type { RenewalsDeps } from "./renewals/index.ts";
import type { MonitorDeps } from "./monitor/index.ts";
import { sqliteSiteStore } from "./monitor/adapters.ts";
import { sqliteRenewalStore } from "./renewals/adapters.ts";
import type { TodosDeps } from "./todos/index.ts";
import type { MorningDeps, TodayDeps } from "./today/index.ts";
import { sqliteMorningLog } from "./today/adapters.ts";
import { sqliteTodoStore } from "./todos/adapters.ts";
import { manageTokens, noBusyCalendar, sqliteBookingStore } from "./booking/adapters.ts";
import { accountAdmin, createHqStaff, sqliteInviteStore, sqliteKitStore, sqliteRefusedLog, sqliteTwoFactorStore, sqliteUserStore, totpCrypto, type Staff } from "./identity/adapters.ts";
import type { RefusedDeps, SessionDeps, TwoFactorDeps } from "./identity/index.ts";
import { sqliteArticleStore } from "./knowledge/adapters.ts";
import type { KnowledgeDeps } from "./knowledge/index.ts";
import { sqliteNoteStore } from "./notes/adapters.ts";
import type { NotesDeps } from "./notes/index.ts";
import { createPortalAuth, sqliteCallStore, sqliteEventReader, sqliteClientUserStore, sqliteUpdateStore } from "./portal/adapters.ts";
import type { PortalDeps } from "./portal/index.ts";
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
  readonly twoFactor: TwoFactorDeps;
  readonly refused: RefusedDeps;
  /** HQ's own sign-in accounts and sessions, kept by the kit. */
  readonly staff: Staff;
  readonly crm: CrmDeps;
  readonly dashboard: RecentActivityDeps;
  readonly audit: AuditDeps;
  readonly search: SearchDeps;
  readonly projects: ProjectsDeps;
  readonly notes: NotesDeps;
  readonly knowledge: KnowledgeDeps;
  readonly proposals: ProposalsDeps;
  readonly finance: FinanceDeps;
  readonly portal: PortalDeps;
  readonly booking: BookingDeps;
  readonly invoiceReminders: RemindersDeps;
  readonly renewals: RenewalsDeps;
  readonly monitor: MonitorDeps;
  readonly touches: TouchDeps;
  readonly todos: TodosDeps;
  /** The day's list, across HQ. */
  readonly day: TodayDeps;
  /** The morning email of that list. */
  readonly morning: MorningDeps;
  readonly renderInvoicePdf: (document: InvoiceDocument) => Uint8Array<ArrayBuffer>;
  readonly renderProposalPdf: (document: ProposalDocument) => Uint8Array<ArrayBuffer>;
  /** Today in the business time zone, YYYY-MM-DD. */
  readonly today: () => string;
  readonly formatWhen: (instant: string) => string;
};

export type ServiceOptions = {
  /** Times already taken in another calendar. None by default. */
  readonly busyCalendar?: BusyCalendar;
  readonly clock?: Clock;
  readonly today?: () => string;
  /** True when served over https: the portal's cookie is then bound to this host. */
  readonly secure?: boolean;
  /** A cheaper password hash, for tests only. */
  readonly passwordCost?: { N: number; r: number; p: number };
};

export function createServices(db: Database, options: ServiceOptions = {}): Services {
  const clock = options.clock ?? systemClock;
  const today = options.today ?? (() => Temporal.Instant.from(clock()).toZonedDateTimeISO(BUSINESS_TIME_ZONE).toPlainDate().toString());
  const formatWhen = formatWhenIn(BUSINESS_TIME_ZONE);
  const users = sqliteUserStore(db);
  const twoFactor: TwoFactorDeps = { users, twoFactor: sqliteTwoFactorStore(db), totp: totpCrypto, activityLog: sqliteActivityLog(db), transact: sqliteTransact(db), clock, newId };
  const staff = createHqStaff(db, { secure: options.secure ?? false, ...(options.passwordCost ? { passwordCost: options.passwordCost } : {}) });
  const session: SessionDeps = { users, invites: sqliteInviteStore(db), accounts: accountAdmin(staff, sqliteKitStore(db)), activityLog: sqliteActivityLog(db), transact: sqliteTransact(db), clock, newId };
  const projectStore = sqliteProjectStore(db);
  const crm: CrmDeps = {
    ...session,
    clients: sqliteClientStore(db),
    contacts: sqliteContactStore(db),
    opportunities: sqliteOpportunityStore(db),
    projects: projectStore,
  };
  const dashboard: RecentActivityDeps = { users, activity: sqliteActivityReader(db), formatWhen };
  const startOfDay = (day: string) => Temporal.PlainDate.from(day).toZonedDateTime(BUSINESS_TIME_ZONE).toInstant().toString();
  const audit: AuditDeps = { users, audit: sqliteAuditReader(db), formatWhen, startOfDay };
  const searchDeps: SearchDeps = { users, search: sqliteSearchReader(db) };
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
  const finance: FinanceDeps = { ...projects, opportunities: crm.opportunities, time: sqliteTimeStore(db), expenses: sqliteExpenseStore(db), finance: sqliteFinanceStore(db), invoices: sqliteInvoiceStore(db), recurring: sqliteRecurringStore(db), phaseEstimates: sqlitePhaseEstimates(db) };
  const notes: NotesDeps = { ...session, notes: sqliteNoteStore(db), formatWhen };
  const knowledge: KnowledgeDeps = { ...session, articles: sqliteArticleStore(db), today, formatWhen };
  const proposals: ProposalsDeps = {
    ...crm,
    ...projects,
    proposals: sqliteProposalStore(db),
    // An accepted proposal drafts its deposit invoice, in the same change.
    onAccepted: (actorId, accepted) => void applyDepositDraft(finance, actorId, accepted),
  };
  const portal: PortalDeps = {
    ...proposals,
    ...finance,
    clientUsers: sqliteClientUserStore(db),
    updates: sqliteUpdateStore(db),
    calls: sqliteCallStore(db),
    events: sqliteEventReader(db),
    auth: createPortalAuth(sqliteKitStore(db), { secure: options.secure ?? false, ...(options.passwordCost ? { passwordCost: options.passwordCost } : {}) }),
  };
  // Who at a client gets their invoices: the primary contact with an email, or else their portal users.
  const clientEmails: ClientEmails = (organizationId) => {
    const users = portal.clientUsers.listFor(organizationId).filter((one) => one.status === "active" && one.portalAccount !== null);
    const primary = crm.contacts.listFor(organizationId).find((one) => one.isPrimary && one.email);
    const email = primary?.email?.toLowerCase();
    if (primary && email) return [{ name: primary.name, email, portal: users.some((one) => one.email === email) }];
    return users.map((one) => ({ name: one.name, email: one.email, portal: true }));
  };
  const invoiceReminders: RemindersDeps = { ...finance, reminders: sqliteReminderStore(db), clientEmails };
  const todos: TodosDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    today,
    todos: sqliteTodoStore(db),
    crm: {
      clientName: (id) => crm.clients.get(id)?.name ?? null,
      opportunity: (id) => {
        const found = crm.opportunities.get(id);
        return found ? { organizationId: found.organizationId, title: found.title } : null;
      },
      clients: () => crm.clients.list().filter((one) => one.status !== "former").map((one) => ({ id: one.id, name: one.name })),
    },
  };
  const touches: TouchDeps = { ...crm, touches: sqliteTouchStore(db), formatWhen, today };
  const monitor: MonitorDeps = { users, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock, newId, today, formatWhen, sites: sqliteSiteStore(db), clientName: (id) => crm.clients.get(id)?.name ?? null };
  const renewals: RenewalsDeps = { users, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock, newId, today, renewals: sqliteRenewalStore(db), clientName: (id) => crm.clients.get(id)?.name ?? null };
  const booking: BookingDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    bookings: sqliteBookingStore(db),
    busy: options.busyCalendar ?? noBusyCalendar,
    tokens: manageTokens,
    timeZone: BUSINESS_TIME_ZONE,
    formatWhen,
  };
  const day: TodayDeps = { crm, todos, booking, portal, projects, renewals, monitor, timeZone: BUSINESS_TIME_ZONE, today, clock };
  const morning: MorningDeps = { ...day, users, activityLog: sqliteActivityLog(db), newId, morning: sqliteMorningLog(db) };
  return { booking, invoiceReminders, renewals, monitor, touches, todos, day, morning, session, twoFactor, refused: { users, refused: sqliteRefusedLog(db), clock, newId, formatWhen }, staff, crm, dashboard, audit, search: searchDeps, projects, notes, knowledge, proposals, finance, portal, renderInvoicePdf, renderProposalPdf, today, formatWhen };
}
