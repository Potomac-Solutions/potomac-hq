// Builds what every application service needs from one open database: the
// stores, the clock and the activity log. The composition root (src/app.ts),
// the commands in bin/ and the tests all start here, so they are wired the
// same way.
import { sqliteCallGuideStore, sqliteCallScreenStore, sqliteClientFacts, sqliteClientStore, sqliteContactStore, sqliteOpportunityStore, sqliteTouchStore } from "./crm/adapters.ts";
import type { CallDeps, CrmDeps, ImportDeps, TouchDeps } from "./crm/index.ts";
import { formatWhenIn, sqliteActivityReader, sqliteAuditReader, sqliteSearchReader } from "./dashboard/adapters.ts";
import type { AuditDeps, RecentActivityDeps, SearchDeps } from "./dashboard/index.ts";
import { renderInvoicePdf, sqliteChangeRequestStore, sqliteExpenseStore, sqliteFinanceStore, sqliteInvoiceStore, sqlitePhaseEstimates, sqliteRecurringStore, sqliteReminderStore, sqliteTimeStore } from "./finance/adapters.ts";
import { addCreditToInvoice, applyDepositDraft, applyTaskMove, createClientInvoice, createInvoice, invoiceLabel, logTime, sendInvoiceNow, type ClientEmails, type FinanceDeps, type InvoiceDocument, type RemindersDeps } from "./finance/index.ts";
import { sha256Hex, sqliteBlobStore, sqliteFileRecordStore } from "./files/adapters.ts";
import type { BookingDeps, InviteDeps, BusyCalendar, OutsideFetch, SourceDeps, LinkDeps } from "./booking/index.ts";
import { addRenewal, type BilledInvoice, type RenewalBilling, type RenewalsDeps } from "./renewals/index.ts";
import type { ReferralsDeps } from "./referrals/index.ts";
import type { NewsletterDeps } from "./newsletter/index.ts";
import type { LeadsDeps } from "./leads/index.ts";
import type { FreePagesDeps } from "./free-pages/index.ts";
import type { ReportsDeps } from "./client-reports/index.ts";
import type { AutomationsDeps } from "./automations/index.ts";
import type { ShowcaseDeps } from "./showcase/index.ts";
import type { ReferralCreditDeps } from "./referral-credit/index.ts";
import type { DemosDeps } from "./demos/index.ts";
import { sqliteDemoLinkStore, sqliteDemoStore } from "./demos/adapters.ts";
import { sqliteReferralCreditStore } from "./referral-credit/adapters.ts";
import { addReferralLink } from "./referrals/index.ts";
import { sqliteCaseStudyStore, sqliteRequestStore, sqliteReviewStore } from "./showcase/adapters.ts";
import { sqliteAutomationStore } from "./automations/adapters.ts";
import { sqliteFactsReader, sqlitePlanClients, sqliteReportStore } from "./client-reports/adapters.ts";
import { sqliteFreePageStore, sqliteRoundStore } from "./free-pages/adapters.ts";
import { sqliteLeadStore } from "./leads/adapters.ts";
import { sqliteIssueStore, sqliteSendStore, sqliteSubscriberStore } from "./newsletter/adapters.ts";
import { setUpSite, type SitePublisher, type WebsitesDeps } from "./websites/index.ts";
import { sqliteSiteSettings, type PublicSiteDeps } from "./public-site/index.ts";
import { builderSpentThisMonth, type BuilderDeps, type Claude, type RepoReader, type SitePublishing } from "./builder/index.ts";
import { previewTokens, sqliteBuilderSettings, sqliteBuildStore, sqliteImageStore, sqlitePublishStore } from "./builder/adapters.ts";
import { siteTokens } from "./public-site/adapters.ts";
import { countyAtlas, sqliteContentSiteStore, sqlitePhotoStore } from "./websites/adapters.ts";
import { sqliteReferralStore, symbologyQr } from "./referrals/adapters.ts";
import type { MonitorDeps } from "./monitor/index.ts";
import { sqliteSiteStore } from "./monitor/adapters.ts";
import { sqliteRenewalStore } from "./renewals/adapters.ts";
import type { SocialDeps } from "./social/index.ts";
import { sqliteSocialStore } from "./social/adapters.ts";
import { addTodo, type TodosDeps } from "./todos/index.ts";
import { withNotices, type NoticesDeps } from "./notices/index.ts";
import { withWebhooks, type HookDescribe, type WebhooksDeps } from "./webhooks/index.ts";
import { sqliteDeliveryStore, sqliteWebhookStore, webhookSigner } from "./webhooks/adapters.ts";
import { sqliteNoticeSettings, sqliteNoticeStore, sqliteTaskReminderStore } from "./notices/adapters.ts";
import type { MorningDeps, TodayDeps } from "./today/index.ts";
import { sqliteMorningLog } from "./today/adapters.ts";
import { sqliteTodoStore } from "./todos/adapters.ts";
import { linkedBusyCalendar, manageTokens, noBusyCalendar, outsideFetch, sqliteBookingLinkStore, sqliteBookingStore, sqliteCalendarLinkStore, sqliteScheduleInviteStore } from "./booking/adapters.ts";
import { withRolePreview } from "./identity/adapters.ts";
import { accountAdmin, createHqStaff, sqliteInviteStore, sqliteKitStore, sqliteRateLimit, sqliteRefusedLog, sqliteTwoFactorStore, sqlitePasskeyStore, passkeyCrypto, sqliteUserStore, totpCrypto, type Staff } from "./identity/adapters.ts";
import { authorize, type RefusedDeps, type SessionDeps, type TwoFactorDeps } from "./identity/index.ts";
import { sqliteArticleStore } from "./knowledge/adapters.ts";
import type { KnowledgeDeps } from "./knowledge/index.ts";
import { sqliteNoteStore } from "./notes/adapters.ts";
import type { NotesDeps } from "./notes/index.ts";
import { createPortalAuth, sqliteCallStore, sqliteEventReader, sqliteClientUserStore, sqlitePeopleLookup, sqliteUpdateStore } from "./portal/adapters.ts";
import type { PortalDeps } from "./portal/index.ts";
import { renderProposalPdf, sqliteProposalStore } from "./proposals/adapters.ts";
import type { ProposalDocument, ProposalsDeps } from "./proposals/index.ts";
import { sqliteBaselineStore, sqliteDeliverableStore, sqliteLabelStore, sqliteWorkStore, sqliteMilestoneStore, sqlitePhaseStore, sqliteProjectHistory, sqliteProjectLinkStore, sqliteProjectStore, sqliteTaskStore, sqliteTaskLinkStore, sqliteCommentStore, sqliteRepeatStore, sqliteCalendarFeedStore, sqliteShareStore, sqliteImportStore } from "./projects/adapters.ts";
import { moveTaskStatus, repeatAfterDone, type ProjectsDeps } from "./projects/index.ts";
import { ceilingDollars, choosingModel, converseWith, featureState, isFeature, useProposalDraft, waitingDraft, waitingDrafts, withDraftOutcomes, type AiModel, type FeaturesDeps } from "./ai/index.ts";
import { type AssistantActions, type AssistantDeps } from "./assistant/index.ts";
import { sqliteAssistantStore } from "./assistant/adapters.ts";
import { placeAt, PLACES, search, type PinsDeps, type Place, type WeeklyDeps } from "./dashboard/index.ts";
import { sqlitePinStore, sqliteWeekFacts, sqliteWeeklySent } from "./dashboard/adapters.ts";
import { sqliteAlertQueue, sqliteAlertSources, sqliteDeviceStore } from "./push/adapters.ts";
import type { PushDeps } from "./push/index.ts";
import type { RepliesDeps } from "./replies/index.ts";
import { sqliteReplyStore } from "./replies/adapters.ts";
import { isQuiet } from "./notices/index.ts";
import { followUpsDue } from "./crm/index.ts";
import { staffWaiting } from "./portal/index.ts";
import { completeTodo, reopenTodo, todosDueFor } from "./todos/index.ts";
import { quickAdd, quickAddPreview } from "./projects/index.ts";
import { createClient, createOpportunity, setOpportunityFollowUp } from "./crm/index.ts";
import { editProjectDetails } from "./projects/index.ts";
import { createBookingLink, nextCalls } from "./booking/index.ts";
import { runningTimer, stopTimer } from "./finance/index.ts";
import { sqliteAiRecords, sqliteAiStore } from "./ai/adapters.ts";
import { SERVICE_LABELS } from "./crm/domain/labels.ts";
import { addChangeRequest, addExpense, EXPENSE_CATEGORIES } from "./finance/index.ts";
import { getReady, logTouch, moveOpportunity, recapFor } from "./crm/index.ts";
import { addNote } from "./notes/index.ts";
import { postProjectUpdate } from "./portal/index.ts";
import { saveProposal, startProposal, TEMPLATES } from "./proposals/index.ts";
import { newId, sqliteActivityLog, sqliteTransact, systemClock, type Database } from "./shared/adapters.ts";
import type { Clock, Id } from "./shared/index.ts";

/** What a module's refusal means, in words the assistant passes on (decision 0015). */
const ASSISTANT_PROBLEMS: Readonly<Record<string, string>> = {
  forbidden: "You don't have permission to do that.",
  "not-found": "That record doesn't exist, or you can't see it.",
  "not-understood": "Quick add couldn't read that line.",
  "project-closed": "That project isn't active.",
  "person-not-found": "There's nobody in HQ by that name.",
  "invalid-status": "That isn't a status a task can have.",
  "note-missing": "Say what was said.",
  "note-too-long": "The note is too long.",
  "name-missing": "Give the client a name.",
  "title-missing": "Give it a title.",
  closed: "That deal is already won or lost.",
  "not-running": "No timer is running.",
  "opportunity-closed": "That deal is already won or lost.",
  "invalid-date": "That isn't a date.",
  "not-an-amount": "That isn't an amount.",
  "project-not-active": "That project isn't active.",
};

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
  /** Social media plans and posts (decision 0010). */
  readonly social: SocialDeps;
  /** Potomac's own website: open, coming soon or maintenance, and its banner. */
  readonly publicSite: PublicSiteDeps;
  readonly monitor: MonitorDeps;
  /** Referral links: short addresses printed as QR codes, and what came of them. */
  readonly referrals: ReferralsDeps;
  /** "Notes from the river", the newsletter (decision 0013, section 1). */
  readonly newsletter: NewsletterDeps;
  /** Where leads come from on the website (decision 0013, section 2). */
  readonly leads: LeadsDeps;
  /** Free landing pages and their rounds of changes (decision 0013, section 3). */
  readonly freePages: FreePagesDeps;
  /** Monthly reports to plan clients (decision 0013, section 4). */
  readonly clientReports: ReportsDeps;
  /** n8n automations run for clients (decision 0013, section 5). */
  readonly automations: AutomationsDeps;
  /** Reviews and case studies (decision 0013, section 6). */
  readonly showcase: ShowcaseDeps;
  /** Who referred a lead, clients' own links, and the credit they earn (decision 0013, section 7). */
  readonly referralCredit: ReferralCreditDeps;
  /** The Lab's demos, sent to prospects, and who opened them (decision 0013, section 8). */
  readonly demos: DemosDeps;
  /** Website content: what a client may change on their own site, and publishing it. */
  readonly websites: WebsitesDeps;
  /** The site builder: client websites made with Claude (decision 0010). */
  readonly builder: BuilderDeps;
  readonly touches: TouchDeps;
  /** The call screen: a timed call, logged with its length (decision 0009). */
  readonly calls: CallDeps;
  readonly todos: TodosDeps;
  /** Notices and reminders: what's new for each person. */
  readonly notices: NoticesDeps;
  /** Webhooks: what HQ posts to n8n and the like. */
  readonly webhooks: WebhooksDeps;
  /** The day's list, across HQ. */
  readonly day: TodayDeps;
  /** Scheduling invites: someone paints the times they could do, and a call is confirmed. */
  readonly invites: InviteDeps;
  /** Linked calendars, and filling availability in from a calendar, Timeful or Calendly. */
  readonly sources: SourceDeps;
  /** Importing clients, their contacts and projects from a pasted CSV. */
  readonly clientImport: ImportDeps;
  /** Booking links: booking a call without an account. */
  readonly links: LinkDeps;
  /** The morning email of that list. */
  readonly morning: MorningDeps;
  /** AI assistance (decision 0012): settings, budget, and the drafts each feature writes. */
  readonly ai: FeaturesDeps;
  /** The assistant on Home (decision 0015). */
  readonly assistant: AssistantDeps;
  /** The pages a person may open (decision 0015): the sidebar, search and the assistant read it. */
  readonly placesFor: (actorId: Id | null) => readonly Place[];
  /** Pins in the sidebar (decision 0015, follow-up). */
  readonly pins: PinsDeps;
  /** The weekly owner email (quality of life, 2026-11-25). */
  readonly weekly: WeeklyDeps;
  /** Phone alerts (quality of life, 2026-11-25). */
  readonly push: PushDeps;
  /** Saved replies (quality of life, 2026-11-25). */
  readonly replies: RepliesDeps;
  readonly renderInvoicePdf: (document: InvoiceDocument) => Uint8Array<ArrayBuffer>;
  readonly renderProposalPdf: (document: ProposalDocument) => Uint8Array<ArrayBuffer>;
  /** Today in the business time zone, YYYY-MM-DD. */
  readonly today: () => string;
  readonly formatWhen: (instant: string) => string;
};

export type ServiceOptions = {
  /** Times already taken in another calendar. None by default. */
  readonly busyCalendar?: BusyCalendar;
  /** How addresses people type are read. Tests give their own. */
  readonly outsideFetch?: OutsideFetch;
  /** Reads and commits to client sites' repositories. Without it, sites can't be set up or published. */
  readonly sitePublisher?: SitePublisher | null;
  readonly clock?: Clock;
  /** Potomac's own website address, for its preview link. */
  readonly siteUrl?: string;
  readonly today?: () => string;
  /** True when served over https: the portal's cookie is then bound to this host. */
  readonly secure?: boolean;
  /** A cheaper password hash, for tests only. */
  readonly passwordCost?: { N: number; r: number; p: number };
  /** Outbound email is set up, so notices can be emailed. */
  readonly emailReady?: boolean;
  /** HQ's own key, for signing webhooks. Without it webhooks can't be added or sent. */
  readonly webhookKey?: string;
  /** HQ's own address, for links in webhook payloads. */
  readonly publicUrl?: string;
  /** The site builder's link to Claude. Without it, Claude can't be asked. */
  readonly claude?: Claude | null;
  /** The email of the one person who may change the site builder's model and cap. */
  /** HQ_SITE_BUILDER_OWNER: one email or several. */
  readonly builderOwner?: string | readonly string[] | null;
  /** Signs the site builder's preview addresses. Without it, a key made for this process. */
  readonly previewSecret?: string;
  /** Reads repositories for the site builder to rework. Without it, only addresses can be reworked. */
  readonly builderRepos?: RepoReader | null;
  /** Puts site builder versions on GitHub. Without it, versions can only be downloaded. */
  readonly builderPublishing?: SitePublishing | null;
  /** Runs a job after the answer is sent: a request to Claude. Errors go to the log. */
  readonly runLater?: (job: () => Promise<void>) => void;
  /** Claude, when HQ_ANTHROPIC_API_KEY is set; tests give a stand-in. Without it, AI is off. */
  readonly aiModel?: AiModel | null;
  /** HQ's VAPID public key, when phone alerts are set up. */
  readonly vapidPublicKey?: string | null;
};

const ownersOf = (owner: string | readonly string[] | null | undefined): readonly string[] => (owner == null ? [] : typeof owner === "string" ? [owner.toLowerCase()] : owner.map((one) => one.toLowerCase()));

export function createServices(db: Database, options: ServiceOptions = {}): Services {
  const clock = options.clock ?? systemClock;
  const today = options.today ?? (() => Temporal.Instant.from(clock()).toZonedDateTimeISO(BUSINESS_TIME_ZONE).toPlainDate().toString());
  const formatWhen = formatWhenIn(BUSINESS_TIME_ZONE);
  // Admins can view HQ as a manager or member, read-only (quality of life, 2026-11-25).
  const users = withRolePreview(db, sqliteUserStore(db));
  const twoFactor: TwoFactorDeps = { users, twoFactor: sqliteTwoFactorStore(db), totp: totpCrypto, passkeys: sqlitePasskeyStore(db), webauthn: passkeyCrypto, activityLog: sqliteActivityLog(db), transact: sqliteTransact(db), clock, newId };
  const staff = createHqStaff(db, { secure: options.secure ?? false, ...(options.passwordCost ? { passwordCost: options.passwordCost } : {}) });
  const session: SessionDeps = { users, invites: sqliteInviteStore(db), accounts: accountAdmin(staff, sqliteKitStore(db)), activityLog: sqliteActivityLog(db), transact: sqliteTransact(db), clock, newId };
  const projectStore = sqliteProjectStore(db);
  // Tasks, to-dos and comments are recorded through this log, so each event makes its notices (decision 0007, section 8).
  const noticeStore = sqliteNoticeStore(db);
  const reminderStore = sqliteTaskReminderStore(db);
  const noticingLog = withNotices(sqliteActivityLog(db), { notices: noticeStore, reminders: reminderStore, newId, clock, zone: BUSINESS_TIME_ZONE });
  // And each event a webhook is sent queues its delivery (decision 0007, section 12). The payload reads the task or project as it is then.
  const base = (options.publicUrl ?? "").replace(/\/$/, "");
  const webhookStores = { webhooks: sqliteWebhookStore(db), deliveries: sqliteDeliveryStore(db) };
  const describe: HookDescribe = {
    task(id) {
      const task = projects.tasks.row(id);
      if (!task) return null;
      const assignee = task.assigneeId ? users.get(task.assigneeId) : null;
      const project = task.projectId ? projectStore.get(task.projectId) : null;
      const client = project ? crm.clients.get(project.organizationId) : null;
      return { id: task.id, title: task.title, status: task.status, priority: task.priority, dueOn: task.dueOn, startOn: task.startOn, project: project ? { id: project.id, name: project.name, client: client?.name ?? null } : null, assignee: assignee ? { name: assignee.name, email: assignee.email } : null, url: `${base}/tasks/${task.id}` };
    },
    project(id) {
      const project = projectStore.get(id);
      if (!project) return null;
      return { id: project.id, name: project.name, status: project.status, client: crm.clients.get(project.organizationId)?.name ?? null, startOn: project.startOn, targetOn: project.targetOn, url: `${base}/projects/${project.id}` };
    },
  };
  // And an AI draft is marked used when what it was for is done by hand (decision 0012).
  const aiStore = sqliteAiStore(db);
  const eventLog = withDraftOutcomes(withWebhooks(noticingLog, { ...webhookStores, describe, users, newId, clock }), aiStore);
  const crm: CrmDeps = {
    ...session,
    activityLog: eventLog,
    clients: sqliteClientStore(db),
    contacts: sqliteContactStore(db),
    opportunities: sqliteOpportunityStore(db),
    projects: projectStore,
  };
  const dashboard: RecentActivityDeps = { users, activity: sqliteActivityReader(db), formatWhen };
  const startOfDay = (day: string) => Temporal.PlainDate.from(day).toZonedDateTime(BUSINESS_TIME_ZONE).toInstant().toString();
  const audit: AuditDeps = { users, audit: sqliteAuditReader(db), formatWhen, startOfDay };
  const searchDeps: SearchDeps = { users, search: sqliteSearchReader(db) };
  // A host's booked calls, for their calendar feed: two weeks back to three months ahead.
  const callsHosted = db.prepare("select id, name, topic, starts_at, ends_at from booking where host_id = ? and status = 'booked' and starts_at >= ? and starts_at <= ? order by starts_at");
  const projects: ProjectsDeps = {
    ...session,
    bookedCalls: (userId, base) => {
      const now = Temporal.Instant.from(clock());
      return callsHosted.all(userId, now.subtract({ hours: 14 * 24 }).toString(), now.add({ hours: 92 * 24 }).toString()).map((row) => {
        const start = String(row["starts_at"]);
        const day = Temporal.Instant.from(start).toZonedDateTimeISO(BUSINESS_TIME_ZONE).toPlainDate().toString();
        return { uid: `call-${String(row["id"])}@potomac-hq`, summary: `Call with ${String(row["name"])}`, description: [String(row["topic"] ?? ""), `Get ready in HQ: ${base}/get-ready/${String(row["id"])}`].filter(Boolean).join("\n"), url: `${base}/get-ready/${String(row["id"])}`, start: day, end: day, at: { start, end: String(row["ends_at"]) } };
      });
    },
    activityLog: eventLog,
    files: sqliteFileRecordStore(db),
    blobs: sqliteBlobStore(db),
    digest: sha256Hex,
    projects: projectStore,
    phases: sqlitePhaseStore(db),
    milestones: sqliteMilestoneStore(db),
    tasks: sqliteTaskStore(db),
    labels: sqliteLabelStore(db),
    work: sqliteWorkStore(db),
    taskLinks: sqliteTaskLinkStore(db),
    comments: sqliteCommentStore(db),
    repeats: sqliteRepeatStore(db),
    feeds: sqliteCalendarFeedStore(db),
    shares: sqliteShareStore(db),
    imports: sqliteImportStore(db),
    zone: BUSINESS_TIME_ZONE,
    feedTokens: siteTokens,
    deliverables: sqliteDeliverableStore(db),
    links: sqliteProjectLinkStore(db),
    baselines: sqliteBaselineStore(db),
    history: sqliteProjectHistory(db),
    today,
    formatWhen,
    // Marking a task "working on" starts the timer, in the same transaction.
    onTaskMoved: (actorId, task, from) => applyTaskMove(finance, actorId, task, from),
  };
  const finance: FinanceDeps = { ...projects, opportunities: crm.opportunities, clients: crm.clients, time: sqliteTimeStore(db), expenses: sqliteExpenseStore(db), finance: sqliteFinanceStore(db), invoices: sqliteInvoiceStore(db), recurring: sqliteRecurringStore(db), phaseEstimates: sqlitePhaseEstimates(db), changes: sqliteChangeRequestStore(db) };
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
    people: sqlitePeopleLookup(db),
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
  const clientReports: ReportsDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    today,
    zone: BUSINESS_TIME_ZONE,
    formatWhen,
    reports: sqliteReportStore(db),
    facts: sqliteFactsReader(db),
    planClients: sqlitePlanClients(db),
    clientName: (id) => crm.clients.get(id)?.name ?? null,
    recipientFor: (organizationId) => clientEmails(organizationId)[0] ?? null,
  };
  const showcase: ShowcaseDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    formatWhen,
    reviews: sqliteReviewStore(db),
    requests: sqliteRequestStore(db),
    studies: sqliteCaseStudyStore(db),
    tokens: siteTokens,
    clientName: (id) => crm.clients.get(id)?.name ?? null,
    contactFor: (organizationId) => clientEmails(organizationId)[0] ?? null,
  };
  const invoiceReminders: RemindersDeps = { ...finance, reminders: sqliteReminderStore(db), clientEmails };
  const todos: TodosDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: eventLog,
    clock,
    newId,
    today,
    todos: sqliteTodoStore(db),
    moveProjectTask: (actorId, taskId, to) => moveTaskStatus(projects, actorId, taskId, to),
    afterTodoDone: (actorId, todoId) => void repeatAfterDone(projects, actorId, todoId),
    labelsFor: (taskIds) => projects.labels.forTasks(taskIds),
    crm: {
      clientName: (id) => crm.clients.get(id)?.name ?? null,
      opportunity: (id) => {
        const found = crm.opportunities.get(id);
        return found ? { organizationId: found.organizationId, title: found.title } : null;
      },
      clients: () => crm.clients.list().filter((one) => one.status !== "former").map((one) => ({ id: one.id, name: one.name })),
    },
  };
  const touches: TouchDeps = { ...crm, touches: sqliteTouchStore(db), formatWhen, today, timeZone: BUSINESS_TIME_ZONE };
  const calls: CallDeps = {
    ...touches,
    calls: sqliteCallScreenStore(db),
    guides: sqliteCallGuideStore(db),
    facts: sqliteClientFacts(db),
    // Ending a call: next steps as to-dos and the call's time on a project, through their own services (decision 0009).
    followThrough: {
      addTodo: (actorId, input) => addTodo(todos, actorId, { title: input.title, clientId: input.clientId, opportunityId: input.opportunityId }),
      logTime: (actorId, projectId, input) => logTime(finance, actorId, { projectId }, input),
    },
  };
  const monitor: MonitorDeps = { users, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock, newId, today, formatWhen, sites: sqliteSiteStore(db), clientName: (id) => crm.clients.get(id)?.name ?? null };
  const referrals: ReferralsDeps = { users, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock, newId, formatWhen, links: sqliteReferralStore(db), qr: symbologyQr, opportunityTitle: (id) => crm.opportunities.get(id)?.title ?? null, random: (length) => crypto.getRandomValues(new Uint8Array(length)) };
  const newsletter: NewsletterDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    formatWhen,
    subscribers: sqliteSubscriberStore(db),
    issues: sqliteIssueStore(db),
    sends: sqliteSendStore(db),
    tokens: siteTokens,
    clientByEmail: (email) => {
      const contact = crm.contacts.byEmail(email);
      const client = contact ? crm.clients.get(contact.organizationId) : null;
      return client ? { id: client.id, name: client.name } : null;
    },
  };
  const leads: LeadsDeps = {
    users,
    transact: sqliteTransact(db),
    clock,
    leads: sqliteLeadStore(db),
    opportunityOf: (id) => {
      const found = crm.opportunities.get(id);
      return found ? { leadSource: found.leadSource, referralCode: null } : null;
    },
  };
  const automations: AutomationsDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    formatWhen,
    automations: sqliteAutomationStore(db),
    tokens: siteTokens,
    clientName: (id) => crm.clients.get(id)?.name ?? null,
  };
  const freePages: FreePagesDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    formatWhen,
    pages: sqliteFreePageStore(db),
    rounds: sqliteRoundStore(db),
    clientName: (id) => crm.clients.get(id)?.name ?? null,
    // A free page on the client's own domain: the domain goes on their renewals, yearly, ready to bill.
    addDomainRenewal: (actorId, organizationId, input) => {
      if (renewals.renewals.listFor(organizationId).some((one) => one.active && one.name.toLowerCase() === input.domain)) return { ok: true, value: "already-there" };
      const added = addRenewal(renewals, actorId, organizationId, { kind: "domain", name: input.domain, renewsOn: input.renewsOn, termMonths: "12", cost: input.cost, price: input.price, note: "Added with the client's free landing page." });
      return added.ok ? { ok: true, value: "added" } : { ok: false, error: added.error };
    },
    peopleAt: (organizationId) => {
      const contacts = crm.contacts.listFor(organizationId);
      const portalUsers = portal.clientUsers.listFor(organizationId);
      return { emails: [...contacts.flatMap((one) => (one.email ? [one.email] : [])), ...portalUsers.map((one) => one.email)], phones: contacts.flatMap((one) => (one.phone ? [one.phone] : [])) };
    },
  };
  const websites: WebsitesDeps = { users, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock, newId, formatWhen, sites: sqliteContentSiteStore(db), photos: sqlitePhotoStore(db), counties: countyAtlas(), clientName: (id) => crm.clients.get(id)?.name ?? null, publisher: options.sitePublisher ?? null, timeZone: BUSINESS_TIME_ZONE, digest: (text) => sha256Hex(new TextEncoder().encode(text)), random: (length) => crypto.getRandomValues(new Uint8Array(length)) };
  // Renewals bill a client through finance: an invoice with one line on one of their projects, sent.
  const billedOf = (id: Id): BilledInvoice | null => {
    const row = finance.invoices.get(id);
    return row ? { id: row.id, label: invoiceLabel(row.number), status: row.status, owedMinor: row.total.minor - row.paidMinor } : null;
  };
  const renewalBilling: RenewalBilling = {
    projectsFor: (organizationId) => projectStore.listFor(organizationId).map((project) => ({ id: project.id, name: project.name })),
    send(actorId, organizationId, projectId, line) {
      if (projectId !== null && projectStore.get(projectId)?.organizationId !== organizationId) return { ok: false, error: "not-found" };
      const input = { kind: "other", description: line.description, amount: (line.amount.minor / 100).toFixed(2), dueOn: line.dueOn };
      const made = projectId === null ? createClientInvoice(finance, actorId, organizationId, input) : createInvoice(finance, actorId, projectId, input);
      if (!made.ok) return { ok: false, error: made.error === "forbidden" ? "forbidden" : "not-found" };
      const sent = sendInvoiceNow(finance, actorId, made.value.id);
      if (!sent.ok) return { ok: false, error: sent.error === "forbidden" ? "forbidden" : "not-found" };
      const row = billedOf(sent.value.id);
      return row ? { ok: true, value: row } : { ok: false, error: "not-found" };
    },
    invoice: billedOf,
    mayBill: (actorId) => authorize({ users }, actorId, "invoice.edit").ok,
  };
  // What a client's public website may say about them: nothing more private (decision 0010).
  const builder: BuilderDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    formatWhen,
    builds: sqliteBuildStore(db),
    images: sqliteImageStore(db),
    settings: sqliteBuilderSettings(db),
    claude: options.claude ?? null,
    repos: options.builderRepos ?? null,
    publishing: options.builderPublishing ?? null,
    publishes: sqlitePublishStore(db),
    setUpEditing: async (actorId, organizationId, input) => (await setUpSite(websites, actorId, organizationId, { ...input, siteUrl: "" })).ok,
    fetchPage: options.outsideFetch ?? outsideFetch,
    previewTokens: previewTokens(options.previewSecret ?? crypto.randomUUID() + crypto.randomUUID()),
    clientFacts: (id) => {
      const client = crm.clients.get(id);
      if (!client) return null;
      const contact = crm.contacts.listFor(id).find((one) => one.isPrimary) ?? null;
      return { name: client.name, phone: client.phone, address: client.address, website: client.website, contact: contact ? { name: contact.name, email: contact.email, phone: contact.phone, title: contact.title } : null };
    },
    clients: () => crm.clients.list().map((one) => ({ id: one.id, name: one.name })).sort((a, b) => a.name.localeCompare(b.name)),
    ownerEmails: ownersOf(options.builderOwner),
    timeZone: BUSINESS_TIME_ZONE,
    runLater: options.runLater ?? ((job) => void job().catch((error: unknown) => console.error("Site builder: a request failed", error))),
    // The cap is shared with the AI drafts (Mikey, 2026-11-25): what they spent this month counts too.
    alsoSpent: () => aiStore.spentSince(startOfDay(`${today().slice(0, 7)}-01`)),
    // The highest model anyone may pick for one request: Settings → AI sets it for both.
    ceiling: () => ceilingDollars(aiStore.settings()),
  };
  const lastTouch = db.prepare("select max(t.happened_at) as at from touch t join opportunity o on o.organization_id = t.organization_id where o.id = ?");
  const demos: DemosDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    formatWhen,
    demos: sqliteDemoStore(db),
    links: sqliteDemoLinkStore(db),
    random: (length) => crypto.getRandomValues(new Uint8Array(length)),
    opportunity: (id) => {
      const found = crm.opportunities.get(id);
      if (!found) return null;
      const contact = found.contactId ? crm.contacts.get(found.contactId) : null;
      const to = contact?.email ? { name: contact.name, email: contact.email } : (clientEmails(found.organizationId)[0] ?? null);
      return { title: found.title, organizationId: found.organizationId, clientName: crm.clients.get(found.organizationId)?.name ?? "", to };
    },
    lastTouchAt: (opportunityId) => {
      const at = lastTouch.get(opportunityId)?.["at"];
      return typeof at === "string" ? at : null;
    },
  };
  const referralCredit: ReferralCreditDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    formatWhen,
    store: sqliteReferralCreditStore(db),
    clientName: (id) => crm.clients.get(id)?.name ?? null,
    opportunityExists: (id) => crm.opportunities.get(id) !== null,
    makeLink: (actorId, input) => addReferralLink(referrals, actorId, input),
    applyCredit: (actorId, invoiceId, minor) => addCreditToInvoice(finance, actorId, invoiceId, { description: "Referral credit: thank you for sending a friend our way", minor }),
    siteUrl: `${(options.siteUrl ?? "https://potomac.solutions").replace(/\/$/, "")}/`,
    clientOptions: () => crm.clients.list().filter((one) => one.status !== "former").map((one) => ({ id: one.id, name: one.name })),
  };
  const publicSite: PublicSiteDeps = { users, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock, newId, site: sqliteSiteSettings(db), tokens: siteTokens, siteUrl: (options.siteUrl ?? "https://potomac.solutions").replace(/\/$/, "") };
  const renewals: RenewalsDeps = { users, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock, newId, today, renewals: sqliteRenewalStore(db), clientName: (id) => crm.clients.get(id)?.name ?? null, billing: renewalBilling };
  const social: SocialDeps = { users, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock, newId, today, timeZone: BUSINESS_TIME_ZONE, social: sqliteSocialStore(db), clientName: (id) => crm.clients.get(id)?.name ?? null };
  const calendarLinks = sqliteCalendarLinkStore(db);
  const outside = options.outsideFetch ?? outsideFetch;
  const booking: BookingDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    bookings: sqliteBookingStore(db),
    busy: linkedBusyCalendar(options.busyCalendar ?? noBusyCalendar, calendarLinks, outside, { timeZone: BUSINESS_TIME_ZONE }),
    tokens: manageTokens,
    timeZone: BUSINESS_TIME_ZONE,
    formatWhen,
  };
  const clientUsers = sqliteClientUserStore(db);
  const invites: InviteDeps = {
    ...booking,
    invites: sqliteScheduleInviteStore(db),
    people: {
      get: (id) => {
        const found = clientUsers.get(id);
        return found ? { organizationId: found.organizationId, name: found.name, email: found.email, active: found.status !== "disabled" } : null;
      },
    },
  };
  const clientImport: ImportDeps = { ...crm, links: projects.links };
  const sources: SourceDeps = { ...invites, links: calendarLinks, outside, allowImport: sqliteRateLimit(db, { name: "availability-import", max: 10, windowMs: 60 * 60_000 }) };
  const links: LinkDeps = { ...booking, links: sqliteBookingLinkStore(db) };
  const day: TodayDeps = { crm: touches, todos, booking, portal, projects, renewals, social, monitor, freePages, clientReports, automations, showcase, demos, timeZone: BUSINESS_TIME_ZONE, today, clock };
  const morning: MorningDeps = { ...day, users, activityLog: sqliteActivityLog(db), newId, morning: sqliteMorningLog(db) };
  const notices: NoticesDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    notices: noticeStore,
    reminders: reminderStore,
    settings: sqliteNoticeSettings(db),
    task: (taskId) => {
      const task = projects.tasks.get(taskId);
      return task ? { title: task.title, dueOn: task.dueOn, done: task.status === "done", assigneeId: task.assigneeId } : null;
    },
    zone: BUSINESS_TIME_ZONE,
    emailReady: options.emailReady ?? false,
  };
  const webhooks: WebhooksDeps = { users, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock, newId, ...webhookStores, signer: options.webhookKey ? webhookSigner(options.webhookKey) : null, describe };
  const services = Object.entries(SERVICE_LABELS).map(([key, label]) => ({ key, label }));
  const ai: FeaturesDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    formatWhen,
    today,
    startOfDay,
    monthStart: () => startOfDay(`${today().slice(0, 7)}-01`),
    ai: aiStore,
    model: options.aiModel ?? null,
    ownerEmails: ownersOf(options.builderOwner),
    // One budget, shared with the site builder (Mikey, 2026-11-25): its cap, and what it has spent.
    sharedBudget: () => ({ capCents: builder.settings.get().capCents, builderSpent: builderSpentThisMonth(builder) }),
    records: sqliteAiRecords(db),
    links: {
      recap(actorId, callId) {
        const recap = recapFor(calls, actorId, callId);
        if (!recap.ok) return recap.error === "no-email" ? "no-email" : null;
        const call = calls.calls.get(callId);
        if (!call) return null;
        return { client: recap.value.clientName, contact: recap.value.toName, me: users.get(actorId)?.name ?? "", notes: call.note, organizationId: call.organizationId, opportunityId: call.opportunityId };
      },
      getReady(actorId, bookingId) {
        const ready = getReady(calls, actorId, bookingId);
        if (!ready.ok) return null;
        return { organizationId: (ready.value.clientId || null) as Id | null, client: ready.value.clientName, contact: ready.value.name, why: ready.value.topic, points: ready.value.points.map((one) => one.text) };
      },
      addTodo: (actorId, input) => addTodo(todos, actorId, { title: input.title, clientId: input.clientId, opportunityId: input.opportunityId }),
      logEmail: (actorId, opportunityId, contactId, note) => logTouch(touches, actorId, { opportunityId }, { kind: "email", note, contactId }),
      addNote: (actorId, opportunityId, body) => addNote(notes, actorId, { recordType: "opportunity", recordId: opportunityId, body }),
      markLost: (actorId, opportunityId, reason) => moveOpportunity(crm, actorId, opportunityId, { to: "lost", lostReason: reason }),
      startProposal(actorId, opportunityId, draft) {
        const started = startProposal(proposals, actorId, opportunityId, {});
        if (!started.ok) return started;
        const saved = saveProposal(proposals, actorId, started.value.id, {
          title: draft.title,
          pricing: started.value.pricing,
          scope: draft.scope,
          assumptions: draft.assumptions,
          exclusions: draft.exclusions,
          deliverables: draft.deliverables,
          lines: draft.lines.map((line) => ({ item: line.item, kind: line.kind, quantity: String(line.quantity), rate: line.rate.toFixed(2) })),
        });
        return saved.ok ? { ok: true, value: saved.value.id } : saved;
      },
      addChange: (actorId, projectId, input) => addChangeRequest(finance, actorId, projectId, input),
      postUpdate: (actorId, projectId, body) => postProjectUpdate(portal, actorId, projectId, body),
      addExpense: (actorId, projectId, input, receipt) => addExpense(finance, actorId, projectId, { ...input, receipt }),
      template(service) {
        const found = TEMPLATES[service];
        return found ? { scope: found.scope, assumptions: found.assumptions, exclusions: found.exclusions, deliverables: found.deliverables, lines: found.lines } : null;
      },
      services,
      expenseCategories: EXPENSE_CATEGORIES,
    },
  };
  // The pages a person may open (decision 0015). Each page still checks for itself.
  const placesFor = (actorId: Id | null): readonly Place[] => {
    if (actorId === null) return [];
    const allows = (gate: string | undefined): boolean => {
      if (!gate) return true;
      if (gate.startsWith("perm:")) return authorize({ users }, actorId, gate.slice(5)).ok;
      const manage = authorize({ users }, actorId, "ai.manage").ok;
      if (gate === "ai:manage") return manage;
      if (gate === "ai:drafts") return manage || waitingDrafts(ai, actorId, () => "").items.length > 0;
      if (gate.startsWith("ai:")) return gate.slice(3).split("|").some((feature) => isFeature(feature) && featureState(ai, actorId, feature).on);
      return false;
    };
    return PLACES.filter((place) => allows(place.gate));
  };

  // What the assistant may do (decision 0015), each through its own module.
  const may = (actorId: Id, permission: string) => authorize({ users }, actorId, permission).ok;
  const failed = (error: string) => ({ ok: false as const, error: ASSISTANT_PROBLEMS[error] ?? error });
  const actions: AssistantActions = {
    brief(actorId) {
      const name = (users.get(actorId)?.name ?? "").split(" ")[0] ?? "";
      const hour = Temporal.Instant.from(clock()).toZonedDateTimeISO(BUSINESS_TIME_ZONE).hour;
      const hello = `${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}${name ? `, ${name}` : ""}.`;
      const waiting = staffWaiting(portal, actorId).items;
      const follow = followUpsDue(crm, actorId, today());
      const followUps = follow.ok ? follow.value.items : [];
      const due = todosDueFor(todos, actorId);
      const next = nextCalls(booking, actorId, 1)?.[0] ?? null;
      const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
      const parts = [
        ...(waiting.length ? [`[${count(waiting.length, "thing a client is waiting on", "things clients are waiting on")}](/#waiting-on-you)`] : []),
        ...(followUps.length ? [`[${count(followUps.length, "follow-up", "follow-ups")} due](/today)`] : []),
        ...(due.length ? [`[${count(due.length, "to-do", "to-dos")} due](/todos)`] : []),
      ];
      const first = waiting[0] ? `First up: ${waiting[0].text}.` : followUps[0] ? `First up: follow up on ${followUps[0].title} (${followUps[0].clientName}).` : due[0] ? `First up: ${due[0].title}.` : "";
      const call = next ? ` Next call: ${next.who}, ${next.when}.` : "";
      return parts.length ? `${hello} You have ${parts.join(", ")}. ${first}${call}` : `${hello} Nothing is waiting on you.${call}`;
    },
    find(actorId, query) {
      const found = search(searchDeps, actorId, query, placesFor(actorId));
      const idOf = (href: string) => /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(href)?.[1] ?? "";
      return {
        pages: found.pages.map((page) => ({ name: page.label, address: page.href, what: page.what })),
        records: found.groups.flatMap((group) => group.hits.map((hit) => ({ kind: group.label, id: idOf(hit.href), name: hit.name, about: hit.context, status: hit.extra, address: hit.href }))),
      };
    },
    due(actorId) {
      const follow = followUpsDue(crm, actorId, today());
      return {
        clientsWaiting: staffWaiting(portal, actorId).items.map((item) => ({ what: item.text, detail: item.detail, address: item.href })),
        followUps: follow.ok ? follow.value.items.map((item) => ({ deal: item.title, client: item.clientName, due: item.followUpText, overdue: item.overdue, address: `/opportunities/${item.id}` })) : [],
        toDos: todosDueFor(todos, actorId).map((line) => ({ id: line.id, title: line.title, due: line.when, client: line.clientName, address: line.href })),
      };
    },
    knowledge(actorId, query) {
      if (!may(actorId, "knowledge.view")) return { articles: [] };
      return { articles: ai.records.articles(query.split(/[^A-Za-z0-9]+/).filter(Boolean), 3).map((one) => ({ title: one.title, address: `/knowledge/${one.slug}`, text: one.body.slice(0, 1500) })) };
    },
    preview(actorId, line) {
      const view = quickAddPreview(projects, actorId, { text: line, skip: [] });
      if (!view.ok) return { canSave: false, says: "", problem: "You may not add tasks." };
      const parts = view.value.parts.filter((part) => !part.problem).map((part) => part.says);
      const problem = view.value.problem || view.value.parts.find((part) => part.problem)?.problem || "";
      return { canSave: view.value.canSave, says: [`Add ${view.value.kind === "" ? "a to-do" : view.value.kind.toLowerCase()}: “${view.value.title}”`, ...parts].join(" · "), problem };
    },
    quickAdd(actorId, line) {
      const added = quickAdd(projects, actorId, { text: line, skip: [] });
      return added.ok ? { ok: true, value: { href: added.value.href } } : failed(added.error);
    },
    task(actorId, id) {
      if (!may(actorId, "task.view")) return null;
      const task = projects.tasks.get(id);
      return task ? { title: task.title, status: task.status, done: task.status === "done", href: `/tasks/${task.id}` } : null;
    },
    moveTask(actorId, id, to) {
      const moved = moveTaskStatus(projects, actorId, id, to);
      return moved.ok || moved.error === "unchanged" ? { ok: true, value: { href: `/tasks/${id}` } } : failed(moved.error);
    },
    setDone(actorId, id, done) {
      const changed = done ? completeTodo(todos, actorId, id) : reopenTodo(todos, actorId, id);
      return changed.ok ? { ok: true, value: { href: `/tasks/${id}` } } : failed(changed.error);
    },
    record(actorId, on, id) {
      if (on === "client") {
        const client = may(actorId, "client.view") ? crm.clients.get(id) : null;
        return client ? { name: client.name, href: `/clients/${client.id}` } : null;
      }
      if (on === "opportunity") {
        const deal = may(actorId, "opportunity.view") ? crm.opportunities.get(id) : null;
        return deal ? { name: `${deal.title} (${crm.clients.get(deal.organizationId)?.name ?? "a client"})`, href: `/opportunities/${deal.id}` } : null;
      }
      const project = may(actorId, "project.view") ? projectStore.get(id) : null;
      return project ? { name: project.name, href: `/projects/${project.id}` } : null;
    },
    addNote(actorId, on, id, body) {
      const recordType = on === "client" ? "client-organization" : on;
      const added = addNote(notes, actorId, { recordType, recordId: id, body });
      return added.ok ? { ok: true, value: { href: on === "client" ? `/clients/${id}` : `/${on === "opportunity" ? "opportunities" : "projects"}/${id}` } } : failed(added.error);
    },
    logContact(actorId, where, input) {
      const logged = logTouch(touches, actorId, where, { kind: input.kind, outcome: input.outcome || null, note: input.note || null, followUpOn: input.followUpOn || null });
      return logged.ok ? { ok: true, value: { href: "opportunityId" in where ? `/opportunities/${where.opportunityId}` : `/clients/${where.clientId}` } } : failed(logged.error);
    },
    addClient(actorId, input) {
      const made = createClient(crm, actorId, { name: input.name, website: input.website || null, phone: input.phone || null, address: input.address || null });
      return made.ok ? { ok: true, value: { href: `/clients/${made.value.id}` } } : failed(made.error);
    },
    openDeal(actorId, clientId, input) {
      const made = createOpportunity(crm, actorId, clientId, { title: input.title, leadSource: input.leadSource, service: input.service || null, summary: input.summary || null });
      return made.ok ? { ok: true, value: { href: `/opportunities/${made.value.id}` } } : failed(made.error);
    },
    deal(actorId, id) {
      const deal = may(actorId, "opportunity.view") ? crm.opportunities.get(id) : null;
      return deal ? { name: `${deal.title} (${crm.clients.get(deal.organizationId)?.name ?? "a client"})`, followUpOn: deal.followUpOn ?? "", open: deal.stage !== "won" && deal.stage !== "lost" } : null;
    },
    setFollowUp(actorId, id, on) {
      const set = setOpportunityFollowUp(crm, actorId, id, on || null);
      return set.ok ? { ok: true, value: { href: `/opportunities/${id}` } } : failed(set.error);
    },
    project(actorId, id) {
      const project = may(actorId, "project.view") ? projectStore.get(id) : null;
      return project ? { name: project.name, health: project.health } : null;
    },
    setHealth(actorId, id, health) {
      const project = projectStore.get(id);
      if (!project) return failed("not-found");
      const edited = editProjectDetails(projects, actorId, id, { name: project.name, description: project.description, health, startOn: project.startOn, targetOn: project.targetOn });
      return edited.ok ? { ok: true, value: { href: `/projects/${id}` } } : failed(edited.error);
    },
    timer(actorId) {
      const running = runningTimer(finance, actorId);
      return running.running ? `${running.label}, ${running.since}` : "";
    },
    stopTimer(actorId) {
      const stopped = stopTimer(finance, actorId);
      return stopped.ok ? { ok: true, value: { href: "/time" } } : failed(stopped.error);
    },
    bookingLink(actorId, input) {
      const made = createBookingLink(links, actorId, input);
      // The link's address is its key: it stays on the Calls page, not in the conversation or the log.
      return made.ok ? { ok: true, value: { href: "/calls#links" } } : failed(made.error);
    },
    proposalDraftWaiting: (actorId, opportunityId) => waitingDraft(ai, actorId, "proposal-draft", opportunityId) !== null,
    startProposal(actorId, opportunityId) {
      const draft = waitingDraft(ai, actorId, "proposal-draft", opportunityId);
      const started = draft ? useProposalDraft(ai, actorId, draft.id) : (() => {
        const made = startProposal(proposals, actorId, opportunityId, {});
        return made.ok ? { ok: true as const, value: made.value.id } : made;
      })();
      return started.ok ? { ok: true, value: { href: `/proposals/${started.value}` } } : failed(String(started.error));
    },
    draftInvoice(actorId, projectId, input) {
      const made = createInvoice(finance, actorId, projectId, { kind: input.kind, description: input.description, amount: input.amount, dueOn: input.dueOn || null });
      return made.ok ? { ok: true, value: { href: `/invoices/${made.value.id}` } } : failed(made.error);
    },
  };
  // What a page is called, for pinning: a page's own name, or a record's.
  const labelFor = (actorId: Id, href: string): string | null => {
    const [path = "", query = ""] = href.split("?");
    const places = placesFor(actorId);
    const exact = places.find((place) => place.href === path);
    if (exact) return query ? `${exact.label} (filtered)` : exact.label;
    const id = /^\/(clients|opportunities|projects|tasks)\/([0-9a-f-]{36})(?:\/|$)/.exec(path);
    if (id) {
      const [, kind, recordId] = id as unknown as [string, string, Id];
      if (kind === "tasks") return actions.task(actorId, recordId)?.title ?? null;
      return actions.record(actorId, kind === "clients" ? "client" : kind === "opportunities" ? "opportunity" : "project", recordId)?.name ?? null;
    }
    const under = placeAt(places, path);
    return under ? `${under.label}: ${path.split("/").filter(Boolean).slice(1).join(" ")}`.slice(0, 120) : null;
  };
  const pins: PinsDeps = { users, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock, newId, pins: sqlitePinStore(db), labelFor };

  const replies: RepliesDeps = { users, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock, newId, replies: sqliteReplyStore(db) };
  const noticePrefs = sqliteNoticeSettings(db);
  const push: PushDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    devices: sqliteDeviceStore(db),
    queue: sqliteAlertQueue(db),
    sources: sqliteAlertSources(db),
    publicKey: options.vapidPublicKey ?? null,
    quietNow: (userId) => isQuiet(noticePrefs.preferencesOf(userId).quiet, Temporal.Instant.from(clock()).toZonedDateTimeISO(BUSINESS_TIME_ZONE).hour),
    timeOf: (instant) => Temporal.Instant.from(instant).toZonedDateTimeISO(BUSINESS_TIME_ZONE).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
  const weekFacts = sqliteWeekFacts(db);
  const weekly: WeeklyDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    today,
    sentFor: sqliteWeeklySent(db),
    facts(from, to, day) {
      const shared = ai.sharedBudget();
      const spent = ai.ai.spentSince(ai.monthStart()) + shared.builderSpent;
      return { ...weekFacts(from, to, day), ai: `$${(spent / 1_000_000).toFixed(2)} of $${(shared.capCents / 100).toFixed(2)}` };
    },
  };

  const assistant: AssistantDeps = {
    users,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock,
    newId,
    store: sqliteAssistantStore(db),
    actions,
    talk: async (actorId, pick, request) => {
      const answer = await converseWith(choosingModel(ai, pick), actorId, request);
      return answer.ok ? { ok: true, value: { blocks: answer.value.blocks } } : answer;
    },
    todayText: () => Temporal.PlainDate.from(today()).toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    state: (actorId) => featureState(ai, actorId, "assistant"),
  };

  return { ai, assistant, placesFor, pins, weekly, push, replies, notices, webhooks, publicSite, websites, builder, referrals, newsletter, leads, freePages, clientReports, automations, showcase, referralCredit, demos, booking, sources, links, clientImport, invoiceReminders, renewals, social, monitor, touches, calls, todos, day, morning, invites, session, twoFactor, refused: { users, refused: sqliteRefusedLog(db), clock, newId, formatWhen }, staff, crm, dashboard, audit, search: searchDeps, projects, notes, knowledge, proposals, finance, portal, renderInvoicePdf, renderProposalPdf, today, formatWhen };
}
