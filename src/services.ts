// Builds what every application service needs from one open database: the
// stores, the clock and the activity log. The composition root (src/app.ts),
// the commands in bin/ and the tests all start here, so they are wired the
// same way.
import { sqliteCallGuideStore, sqliteCallScreenStore, sqliteClientFacts, sqliteClientStore, sqliteContactStore, sqliteOpportunityStore, sqliteTouchStore } from "./crm/adapters.ts";
import type { CallDeps, CrmDeps, ImportDeps, TouchDeps } from "./crm/index.ts";
import { formatWhenIn, sqliteActivityReader, sqliteAuditReader, sqliteSearchReader } from "./dashboard/adapters.ts";
import type { AuditDeps, RecentActivityDeps, SearchDeps } from "./dashboard/index.ts";
import { renderInvoicePdf, sqliteChangeRequestStore, sqliteExpenseStore, sqliteFinanceStore, sqliteInvoiceStore, sqlitePhaseEstimates, sqliteRecurringStore, sqliteReminderStore, sqliteTimeStore } from "./finance/adapters.ts";
import { applyDepositDraft, applyTaskMove, createInvoice, invoiceLabel, logTime, sendInvoiceNow, type ClientEmails, type FinanceDeps, type InvoiceDocument, type RemindersDeps } from "./finance/index.ts";
import { sha256Hex, sqliteBlobStore, sqliteFileRecordStore } from "./files/adapters.ts";
import type { BookingDeps, InviteDeps, BusyCalendar, OutsideFetch, SourceDeps, LinkDeps } from "./booking/index.ts";
import type { BilledInvoice, RenewalBilling, RenewalsDeps } from "./renewals/index.ts";
import type { ReferralsDeps } from "./referrals/index.ts";
import type { SitePublisher, WebsitesDeps } from "./websites/index.ts";
import { sqliteSiteSettings, type PublicSiteDeps } from "./public-site/index.ts";
import type { BuilderDeps, Claude, RepoReader } from "./builder/index.ts";
import { previewTokens, sqliteBuilderSettings, sqliteBuildStore, sqliteImageStore } from "./builder/adapters.ts";
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
import { withDraftOutcomes, type AiModel, type FeaturesDeps } from "./ai/index.ts";
import { sqliteAiRecords, sqliteAiStore } from "./ai/adapters.ts";
import { SERVICE_LABELS } from "./crm/domain/labels.ts";
import { addChangeRequest, addExpense, EXPENSE_CATEGORIES } from "./finance/index.ts";
import { getReady, logTouch, moveOpportunity, recapFor } from "./crm/index.ts";
import { addNote } from "./notes/index.ts";
import { postProjectUpdate } from "./portal/index.ts";
import { saveProposal, startProposal, TEMPLATES } from "./proposals/index.ts";
import { newId, sqliteActivityLog, sqliteTransact, systemClock, type Database } from "./shared/adapters.ts";
import type { Clock, Id } from "./shared/index.ts";

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
  readonly builderOwner?: string | null;
  /** Signs the site builder's preview addresses. Without it, a key made for this process. */
  readonly previewSecret?: string;
  /** Reads repositories for the site builder to rework. Without it, only addresses can be reworked. */
  readonly builderRepos?: RepoReader | null;
  /** Runs a job after the answer is sent: a request to Claude. Errors go to the log. */
  readonly runLater?: (job: () => Promise<void>) => void;
  /** Claude, when HQ_ANTHROPIC_API_KEY is set; tests give a stand-in. Without it, AI is off. */
  readonly aiModel?: AiModel | null;
};

export function createServices(db: Database, options: ServiceOptions = {}): Services {
  const clock = options.clock ?? systemClock;
  const today = options.today ?? (() => Temporal.Instant.from(clock()).toZonedDateTimeISO(BUSINESS_TIME_ZONE).toPlainDate().toString());
  const formatWhen = formatWhenIn(BUSINESS_TIME_ZONE);
  const users = sqliteUserStore(db);
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
  const projects: ProjectsDeps = {
    ...session,
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
  const finance: FinanceDeps = { ...projects, opportunities: crm.opportunities, time: sqliteTimeStore(db), expenses: sqliteExpenseStore(db), finance: sqliteFinanceStore(db), invoices: sqliteInvoiceStore(db), recurring: sqliteRecurringStore(db), phaseEstimates: sqlitePhaseEstimates(db), changes: sqliteChangeRequestStore(db) };
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
  const websites: WebsitesDeps = { users, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock, newId, formatWhen, sites: sqliteContentSiteStore(db), photos: sqlitePhotoStore(db), counties: countyAtlas(), clientName: (id) => crm.clients.get(id)?.name ?? null, publisher: options.sitePublisher ?? null, timeZone: BUSINESS_TIME_ZONE, digest: (text) => sha256Hex(new TextEncoder().encode(text)), random: (length) => crypto.getRandomValues(new Uint8Array(length)) };
  // Renewals bill a client through finance: an invoice with one line on one of their projects, sent.
  const billedOf = (id: Id): BilledInvoice | null => {
    const row = finance.invoices.get(id);
    return row ? { id: row.id, label: invoiceLabel(row.number), status: row.status, owedMinor: row.total.minor - row.paidMinor } : null;
  };
  const renewalBilling: RenewalBilling = {
    projectsFor: (organizationId) => projectStore.listFor(organizationId).map((project) => ({ id: project.id, name: project.name })),
    send(actorId, organizationId, projectId, line) {
      if (projectStore.get(projectId)?.organizationId !== organizationId) return { ok: false, error: "not-found" };
      const made = createInvoice(finance, actorId, projectId, { kind: "other", description: line.description, amount: (line.amount.minor / 100).toFixed(2), dueOn: line.dueOn });
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
    fetchPage: options.outsideFetch ?? outsideFetch,
    previewTokens: previewTokens(options.previewSecret ?? crypto.randomUUID() + crypto.randomUUID()),
    clientFacts: (id) => {
      const client = crm.clients.get(id);
      if (!client) return null;
      const contact = crm.contacts.listFor(id).find((one) => one.isPrimary) ?? null;
      return { name: client.name, phone: client.phone, address: client.address, website: client.website, contact: contact ? { name: contact.name, email: contact.email, phone: contact.phone, title: contact.title } : null };
    },
    clients: () => crm.clients.list().map((one) => ({ id: one.id, name: one.name })).sort((a, b) => a.name.localeCompare(b.name)),
    ownerEmail: options.builderOwner ?? null,
    timeZone: BUSINESS_TIME_ZONE,
    runLater: options.runLater ?? ((job) => void job().catch((error: unknown) => console.error("Site builder: a request failed", error))),
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
  const day: TodayDeps = { crm: touches, todos, booking, portal, projects, renewals, social, monitor, timeZone: BUSINESS_TIME_ZONE, today, clock };
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
    ownerEmail: options.builderOwner ?? null,
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
  return { ai, notices, webhooks, publicSite, websites, builder, referrals, booking, sources, links, clientImport, invoiceReminders, renewals, social, monitor, touches, calls, todos, day, morning, invites, session, twoFactor, refused: { users, refused: sqliteRefusedLog(db), clock, newId, formatWhen }, staff, crm, dashboard, audit, search: searchDeps, projects, notes, knowledge, proposals, finance, portal, renderInvoicePdf, renderProposalPdf, today, formatWhen };
}
