// The composition root: the one place that knows every layer. It builds the
// adapters, hands them to the application services and routes, and returns a
// Node request listener.
import { getRequestListener } from "@hono/node-server";
import { createRouter, show } from "@zubra/router";
import { createZubra } from "@zubra/server";
import { Hono } from "hono";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { createNotify } from "@potomac-solutions/kit/notify";
import { crmRoutes } from "./crm/api/crm-routes.ts";
import { clientDetail, followUpsDue, listClients, mayImport, opportunityDetail, pipeline, pipelineReport, SERVICE_OPTIONS, clientTouches, opportunityTouches, callScreen, openCall, callGuides, callsToMake, voicemailScript, comingUp, getReady, recapFor, type RecapView, type ComingUp, type GetReadyView, type CallScreen, type CallsToMakeView, type GuidesView, type ScriptView, type TouchesView } from "./crm/index.ts";
import { auditDownloads } from "./dashboard/api/audit-routes.ts";
import { auditHistory, recentActivity, search } from "./dashboard/index.ts";
import { fileRoutes } from "./files/api/file-routes.ts";
import { financeDownloads, financeRoutes } from "./finance/api/finance-routes.ts";
import { clientInvoices, financeOverview, invoicesOverview, projectChanges, hoursThisWeek, invoiceDetail, invoiceReminders, profitAndLoss, projectMoney, projectsOverBudget, recurringOverview, taskTime, timeSheet } from "./finance/index.ts";
import { MAX_FILE_BYTES } from "./files/index.ts";
import { createHqStaffPages, sqliteRateLimit } from "./identity/adapters.ts";
import { peopleRoutes } from "./identity/api/people-routes.ts";
import { forgotRoutes } from "./identity/api/forgot-routes.ts";
import { settingsRoutes } from "./identity/api/settings-routes.ts";
import { staffRoutes } from "./identity/api/staff-routes.ts";
import { authorize, establishUser, listPeople, mustTurnOnTwoFactor, needsSecondStep, recordRefusal, refusedAttempts, requestPasswordReset, shouldTurnOnTwoFactor, THEME_LABELS, twoFactorStatus, type SignedInAccount, type Theme } from "./identity/index.ts";
import { sessionKeyOf } from "./identity/adapters.ts";
import { twoFactorAppRoute, twoFactorQrRoute, twoFactorRoutes } from "./identity/api/two-factor-routes.ts";
import { bookingByLink, bookingOpen, bookingSetup, openInvites, staffInvite, clientInvites, invitesWaitingOn, guestInvite, calendarLinks, bookingLinks, bookingLinkPage, weeklyGrid, weekGrid, callLine, callsForClient, callsView, nextCalls, openTimes, type BusyCalendar, type OutsideFetch, type CallLine, type OpenTimesView } from "./booking/index.ts";
import { bookingStaffDownloads, bookingStaffRoutes } from "./booking/api/staff-routes.ts";
import { allRenewals, clientRenewals, portalRenewals, renewalsComingUp, type ClientRenewalsView } from "./renewals/index.ts";
import { renewalPortalRoutes, renewalRoutes } from "./renewals/api/renewal-routes.ts";
import { clientSocial, clientSocialSummary, portalSocial, portalSocialWaiting, socialOverview, socialToDo } from "./social/index.ts";
import { socialPortalRoutes, socialStaffRoutes } from "./social/api/social-routes.ts";
import { publicSiteView, settingsForSite } from "./public-site/index.ts";
import { publicSiteRoutes, siteApiRoutes } from "./public-site/api/public-site-routes.ts";
import { listTodos, todosAt, todosDueFor, type TodosPanel, type TodosView } from "./todos/index.ts";
import { todoRoutes } from "./todos/api/todo-routes.ts";
import { noticeLinks, noticeRoutes } from "./notices/api/notice-routes.ts";
import { webhookRoutes } from "./webhooks/api/webhook-routes.ts";
import { webhookSecretPage } from "./webhooks/ui/views.ts";
import { listWebhooks, webhookDetail } from "./webhooks/index.ts";
import { listNotices, remindersOn, unreadCount, unreadNotices } from "./notices/index.ts";
import { todayFor, type TodayView } from "./today/index.ts";
import { allSites, clientSites, sitesNeedingAttention, type SitesView } from "./monitor/index.ts";
import { monitorRoutes } from "./monitor/api/monitor-routes.ts";
import { creditInquiry, referralLinks } from "./referrals/index.ts";
import { allWebsites, clientWebsite, portalWebsite, staffWebsite, MAX_PHOTO_BYTES, type ClientWebsiteView, type SitePublisher } from "./websites/index.ts";
import { websiteDownloads, websitePortalRoutes, websiteStaffRoutes } from "./websites/api/website-routes.ts";
import { referralDownloads, referralRoutes } from "./referrals/api/referral-routes.ts";
import { confirmLinkWorks, issueDetail, newsletterOverview, unsubscribeLinkWorks } from "./newsletter/index.ts";
import { keepLeadTouch, leadOrigin, leadSources, touchFields, type LeadOrigin } from "./leads/index.ts";
import { allFreePages, clientFreePage, portalFreePage, type FreePageView, type PortalFreePage, type SiteArchive } from "./free-pages/index.ts";
import { freePageDownloads, freePagePortalRoutes, freePageStaffRoutes } from "./free-pages/api/free-page-routes.ts";
import { monthlyReports, portalReport, portalReports, reportDetail, type PortalReportLine } from "./client-reports/index.ts";
import { reportRoutes } from "./client-reports/api/report-routes.ts";
import { allAutomations, clientAutomations, portalAutomations, type ClientAutomationsView } from "./automations/index.ts";
import { automationHookRoutes, automationRoutes } from "./automations/api/automation-routes.ts";
import { automationSecretPage } from "./automations/ui/views.ts";
import { caseStudyFor, mayWriteReview, reviewLink, showcase } from "./showcase/index.ts";
import { clientReferrals, creditAmount, creditFor, markReferredByLink, portalReferrals, referredByView, type ClientReferralsView } from "./referral-credit/index.ts";
import { referralCreditRoutes } from "./referral-credit/api/referral-credit-routes.ts";
import { demosList, opportunityDemos, type OpportunityDemos } from "./demos/index.ts";
import { demoLinkRoutes, demoRoutes } from "./demos/api/demo-routes.ts";
import { reviewWritingRoutes, showcaseApiRoutes, showcaseDownloads, showcaseStaffRoutes, type AskMail } from "./showcase/api/showcase-routes.ts";
import { newsletterApiRoutes, newsletterRoutes, riverRoutes, type ConfirmMail } from "./newsletter/api/newsletter-routes.ts";
import { buildsView, buildView, builderSettingsView, type Claude, type RepoReader, type SitePublishing } from "./builder/index.ts";
import { builderDownloads, builderRoutes } from "./builder/api/builder-routes.ts";
import { inquiryRoutes } from "./crm/api/inquiry-routes.ts";
import { touchRoutes } from "./crm/api/touch-routes.ts";
import { callRoutes } from "./crm/api/call-routes.ts";
import { bookingPortalDownloads, bookingPortalRoutes, type PortalBooker } from "./booking/api/portal-routes.ts";
import { bookingPublicRoutes } from "./booking/api/public-routes.ts";
import { inviteRoutes } from "./booking/api/invite-routes.ts";
import { sourceRoutes } from "./booking/api/source-routes.ts";
import { linkRoutes } from "./booking/api/link-routes.ts";
import { importRoutes } from "./crm/api/import-routes.ts";
import { problemPage, recoveryCodesPage, userLinkPage } from "./identity/ui/views.ts";
import { knowledgeRoutes } from "./knowledge/api/knowledge-routes.ts";
import { articleDetail, articleRevision, listArticles } from "./knowledge/index.ts";
import { noteRoutes } from "./notes/api/note-routes.ts";
import { clientPortalRoutes, portalDownloads, staffPortalRoutes } from "./portal/api/portal-routes.ts";
import { callsWaiting, clientActivity, clientFiles, clientSession, staffWaiting, portalAccess, portalHome, portalProject, portalProposal, projectUpdates } from "./portal/index.ts";
import { linkPage } from "./portal/ui/views.ts";
import { siteBookingRoutes } from "./portal/api/site-booking-routes.ts";
import { listNotes } from "./notes/index.ts";
import { calendarFeeds, projectRoutes, shareFiles, shareRoutes, workDownloads } from "./projects/api/project-routes.ts";
import { feedAddressPage, shareAddressPage } from "./projects/ui/feed-views.ts";
import { proposalDownloads, proposalRoutes } from "./proposals/api/proposal-routes.ts";
import { listProposals, proposalDetail, proposalsFor, proposalVersion } from "./proposals/index.ts";
import { activeProjects, board, labelsPage, listProjects, pinnedFilters, projectTimeline, projectsTimeline, calendarFeedView, sharedProject, shareLinks, canImportTasks, taskImportPreview, quickAddPreview, readSkip, workTable, projectHealthReport, projectOverview, projectLinks, type ProjectLinksView, projectTasks, taskDetail, upcomingDeadlines } from "./projects/index.ts";
import { createServices } from "./services.ts";
import { aiRoutes } from "./ai/api/ai-routes.ts";
import { aiSettingsView, callBrief, describeDraft, featureState, isFeature, lastAnswer, marketingQueue, modelOptions, waitingDraft, waitingDrafts, type AiModel, type AskDraft, type DraftsView, type FeatureState, type MailDraft, type MarketingLine, type ProposalDraft, type ReceiptDraft, type RecapDraft, type ScopeDraft, type TriageDraft, type UpdateDraft } from "./ai/index.ts";
import type { Database, EmailConfig } from "./shared/adapters.ts";
import { staticRoutes } from "./shared/api/static-routes.ts";
import { err, parseId, recordActivity, type Id, type Result } from "./shared/index.ts";
import { loadAssets, themeLinks } from "./shared/ui/assets.ts";
import { ICON_LINK, renderPage } from "./shared/ui/page.ts";

export { BUSINESS_TIME_ZONE } from "./services.ts";

export type AppConfig = {
  /** An open database with every migration applied. */
  readonly db: Database;
  /** True when served over https. Sets Secure, __Host- cookies. */
  readonly secure: boolean;
  /** How many trusted proxies sit in front (1 on Railway, 0 locally). */
  readonly proxies: number;
  /** Signs the one-line messages shown after a redirect. */
  readonly noticeSecret: string;
  readonly log?: (message: string, error?: unknown) => void;
  /** Other sites whose forms may post to /contact, like https://potomac.solutions. */
  readonly formOrigins?: readonly string[];
  /** Where a new inquiry is emailed. */
  readonly inquiryEmail?: string;
  /** Times already taken in another calendar, such as Google Calendar. */
  readonly busyCalendar?: BusyCalendar;
  /** How addresses people type (a calendar, Timeful, Calendly) are read. Tests give their own. */
  readonly outsideFetch?: OutsideFetch;
  /** Sign-in attempts allowed per address per minute. */
  readonly attemptsPerMinute?: number;
  /**
   * Where the router writes the server halves of pages. Defaults to
   * node_modules/.cache, which the container's user cannot write to.
   */
  readonly cacheDir?: string;
  /** The address people use, such as https://hq.potomac.solutions. Put in front of one-time links. */
  readonly publicUrl?: string;
  /** A cheaper password hash for the portal, for tests only. */
  readonly passwordCost?: { N: number; r: number; p: number };
  /** Whether clients are emailed when something is waiting for them. Off unless set. */
  readonly clientNotices?: boolean;
  /** How a client reaches Potomac, shown in the portal. Each part is left out when empty. */
  readonly contact?: PortalContact;
  /** Reads and commits to client sites' repositories on GitHub. Without it, sites can't be set up or published. */
  readonly sitePublisher?: SitePublisher | null;
  /** Zips a free landing page's code from GitHub, to hand over. Without it, there is no download. */
  readonly siteArchive?: SiteArchive | null;
  /** Outbound email. Without it, "Forgot your password?" says to ask an administrator. */
  readonly email?: EmailConfig | null;
  /** The site builder's link to Claude (decision 0010). Without it, Claude can't be asked. */
  readonly claude?: Claude | null;
  /** The email of the one person who may change the site builder's model and cap. */
  readonly builderOwner?: string | readonly string[] | null;
  /** Reads repositories for the site builder to rework. Without it, only addresses can be reworked. */
  readonly builderRepos?: RepoReader | null;
  /** Puts site builder versions on GitHub. Without it, versions can only be downloaded. */
  readonly builderPublishing?: SitePublishing | null;
  /** Runs a site builder request after the answer is sent. Tests give their own to wait on it. */
  readonly runLater?: (job: () => Promise<void>) => void;
  /** Claude, when HQ_ANTHROPIC_API_KEY is set (decision 0012). Without it, AI is off. */
  readonly ai?: AiModel | null;
};

/** What a page sees of AI (decision 0012). Each part is null when there's nothing, or this person may not see it. */
export type AiPageContext = {
  /** Whether a feature's button shows, and if not, why (empty when it's simply off or not theirs). */
  state(feature: string): FeatureState;
  readonly canManage: boolean;
  /** The models this person may pick for a draft, up to the ceiling, the usual one selected. */
  models(): readonly { readonly id: string; readonly label: string; readonly selected: boolean }[];
  settings(): ReturnType<typeof aiSettingsView>;
  drafts(): DraftsView;
  /** How many drafts wait for this person, without reading what each is about. */
  draftCount(): number;
  recap(callId: string): (RecapDraft & { readonly id: string }) | null;
  brief(bookingId: string): ReturnType<typeof callBrief>;
  deal(opportunityId: string): { readonly triage: (TriageDraft & { readonly id: string; readonly serviceLabel: string }) | null; readonly checkIn: (MailDraft & { readonly id: string }) | null; readonly proposal: (ProposalDraft & { readonly id: string; readonly totalText: string }) | null };
  project(projectId: string): { readonly scope: readonly (ScopeDraft & { readonly id: string; readonly when: string; readonly amountText: string })[]; readonly update: (UpdateDraft & { readonly id: string; readonly when: string }) | null };
  receipt(projectId: string): (ReceiptDraft & { readonly id: string; readonly amountText: string; readonly categories: readonly string[] }) | null;
  ask(): (AskDraft & { readonly when: string; readonly links: readonly { readonly slug: string }[] }) | null;
  marketing(): readonly MarketingLine[] | null;
};

/** Potomac's own phone, email and mailing address, as clients are shown them. */
export type PortalContact = { readonly phone: string; readonly email: string; readonly address: string };

/**
 * Reads the contact details from the environment. Each is optional.
 *   HQ_CONTACT_PHONE     the number clients call
 *   HQ_CONTACT_EMAIL     the address clients write to
 *   HQ_CONTACT_ADDRESS   where a check is mailed, on one line
 */
export function contactFrom(env: NodeJS.ProcessEnv): PortalContact {
  const one = (name: string, most: number) => (env[name] ?? "").replace(/\s+/g, " ").trim().slice(0, most);
  const email = one("HQ_CONTACT_EMAIL", 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("HQ_CONTACT_EMAIL must be an email address.");
  const phone = one("HQ_CONTACT_PHONE", 40);
  if (phone && !/^[0-9+().\- extEXT]+$/.test(phone)) throw new Error("HQ_CONTACT_PHONE must be a phone number, like 304-555-0142.");
  return { phone, email, address: one("HQ_CONTACT_ADDRESS", 200) };
}

export type App = {
  readonly listener: (req: IncomingMessage, res: ServerResponse) => void;
  /** A one-time link for the first owner, or null once anyone has an account. */
  setupPath(): Promise<string | null>;
  /** A one-time password reset link for an account's email, or null if there is no such active account. */
  resetPath(email: string): Promise<string | null>;
};

// Nothing inline is allowed to run. Zubra is told to write no inline script
// or style (`inline: false`), so every script and stylesheet comes from this
// origin. Inline style attributes are allowed because server-rendered Zubra
// UI components use them. The one frame is the site builder's preview, from
// this origin and sandboxed into one of its own (decision 0010).
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

type Answer = ReturnType<typeof show>;

/** What every page's `load` is given as `context`. UI files get the app's services only through this. */
export type PageContext = {
  /** True when a session is live, whether or not it maps to an HQ user. */
  readonly signedIn: boolean;
  /** The active HQ user, or null. */
  readonly user: { readonly id: string; readonly name: string } | null;
  /** A message from the last redirect, shown once. Only ever one the server signed. */
  readonly notice: { readonly problem: string; readonly done: string };
  /** Props for the sign-in page. */
  readonly signIn: { readonly problem: string; readonly done: string; readonly needsOwner: boolean; readonly emailEnabled: boolean };
  /** Today in the business time zone, YYYY-MM-DD. */
  readonly today: string;
  /** Today as a person reads it: "Monday, November 23". */
  readonly todayLabel: string;
  /** The sign-in or no-access page when there is no active HQ user, otherwise null. Every page calls it first. */
  guard(): Answer | null;
  /** The no-access page, for a read that was refused. */
  forbidden(): Answer;
  readonly dashboard: { recentActivity(): ReturnType<typeof recentActivity>; audit(query: Record<string, string>): ReturnType<typeof auditHistory>; refused(): ReturnType<typeof refusedAttempts> };
  readonly crm: {
    clientTouches(id: string): TouchesView | null;
    /** The call screen, for the person on the call (decision 0009). */
    callScreen(id: string): CallScreen | null;
    /** The call guides (decision 0009, section 2), or null without knowledge.view. */
    callGuides(): GuidesView | null;
    /** The voicemail script, as written. */
    voicemailScript(): ScriptView | null;
    /** Today's calls to make (decision 0009, section 5). */
    callsToMake(): CallsToMakeView;
    /** A booked call starting within 15 minutes (decision 0009, section 6). */
    comingUp(): ComingUp | null;
    getReady(bookingId: string): GetReadyView | null;
    /** An ended call's recap email; "no-email" when the contact has none. */
    recap(callId: string): RecapView | "no-email" | null;
    /** Whether HQ can send email. */
    emailOn: boolean;
    /** The person's open call, for the shell. */
    openCall(): { readonly id: string; readonly clientName: string; readonly startedAt: string } | null;
    opportunityTouches(id: string): TouchesView | null;
    inquiryServices(): readonly { readonly value: string; readonly label: string }[];
    listClients(status?: string, demo?: string): ReturnType<typeof listClients>;
    /** May import clients from a CSV. */
    canImport(): boolean;
    pipeline(): ReturnType<typeof pipeline>;
    clientDetail(id: string): ReturnType<typeof clientDetail>;
    opportunityDetail(id: string): ReturnType<typeof opportunityDetail>;
    followUpsDue(): ReturnType<typeof followUpsDue>;
  };
  readonly projects: {
    list(status?: string): ReturnType<typeof listProjects>;
    overview(id: string): ReturnType<typeof projectOverview>;
    links(id: string): ProjectLinksView | null;
    tasks(id: string): ReturnType<typeof projectTasks>;
    /** One project's board, or every active project's when `projectId` is "". */
    board(projectId: string, mine: boolean): ReturnType<typeof board>;
    task(id: string): ReturnType<typeof taskDetail>;
    labels(): ReturnType<typeof labelsPage>;
    /** The work table for the page's address: `params` is `url.searchParams.getAll`. */
    work(params: (name: string) => readonly string[]): ReturnType<typeof workTable>;
    /** One project's timeline, and every active project's (decision 0007, section 9). */
    timeline(id: string): ReturnType<typeof projectTimeline>;
    timelines(): ReturnType<typeof projectsTimeline>;
    /** Your calendar address: whether you have one, and the filters it could follow (decision 0007, section 10). */
    calendar(): ReturnType<typeof calendarFeedView>;
    /** A project's share links, for those who manage them (decision 0007, section 11). */
    shares(projectId: string): ReturnType<typeof shareLinks>;
    /** What a share link shows, with no one signed in; null if it isn't a working link. Records the visit. */
    shared(token: string): ReturnType<typeof sharedProject>;
    /** Importing tasks from Trello or Todoist (decision 0007, section 13). */
    canImport(): boolean;
    importPreview(id: string): ReturnType<typeof taskImportPreview>;
    /** Saved filters pinned to the sidebar. */
    pinned(): ReturnType<typeof pinnedFilters>;
    /** Quick add's preview for the page's address, and the task just added, if any. `params` is `url.searchParams.getAll`. */
    quickAdd(params: (name: string) => readonly string[]): { readonly view: ReturnType<typeof quickAddPreview>; readonly added: string };
    active(): ReturnType<typeof activeProjects>;
    deadlines(): ReturnType<typeof upcomingDeadlines>;
  };
  readonly notes: { list(recordType: string, recordId: string): ReturnType<typeof listNotes> };
  readonly proposals: {
    list(): ReturnType<typeof listProposals>;
    detail(id: string): ReturnType<typeof proposalDetail>;
    version(id: string, number: string): ReturnType<typeof proposalVersion>;
    forOpportunity(id: string): ReturnType<typeof proposalsFor>;
  };
  readonly time: {
    sheet(week: string, everyone: boolean): ReturnType<typeof timeSheet>;
    forTask(taskId: string): ReturnType<typeof taskTime>;
    thisWeek(): ReturnType<typeof hoursThisWeek>;
  };
  readonly money: {
    /** Whether clients are emailed about invoices coming due and overdue, and whether this person may change it. */
    reminders(): { readonly on: boolean; readonly canEdit: boolean; readonly email: boolean };
    invoiceReminders(id: string): ReturnType<typeof invoiceReminders>;
    recurring(): ReturnType<typeof recurringOverview>;
    profit(year: string | null): ReturnType<typeof profitAndLoss>;
    overview(): ReturnType<typeof financeOverview>;
    project(id: string): ReturnType<typeof projectMoney>;
    changes(id: string): ReturnType<typeof projectChanges>;
    overBudget(): ReturnType<typeof projectsOverBudget>;
    invoice(id: string): ReturnType<typeof invoiceDetail>;
    /** Money → Invoices: every invoice, filtered by where it stands. */
    invoices(show: string | null): ReturnType<typeof invoicesOverview>;
    /** A client's invoices, on a project or not; null when this person may not see invoices. */
    forClient(id: string): ReturnType<typeof clientInvoices> | null;
  };
  /** What the viewer may open, so the shell and tabs offer only that. The pages themselves still check. */
  readonly can: { readonly proposals: boolean; readonly money: boolean; readonly time: boolean; readonly audit: boolean; readonly reports: boolean; readonly todos: boolean; readonly add: boolean; readonly calls: boolean; readonly people: boolean; readonly publicSite: boolean; readonly referrals: boolean; readonly webhooks: boolean; readonly social: boolean; readonly siteBuilder: boolean; readonly newsletter: boolean; readonly monthlyReports: boolean; readonly reviews: boolean; readonly demos: boolean };
  /** The site builder (decision 0010). */
  readonly builder: {
    list(): ReturnType<typeof buildsView>;
    /** A build; `version` is the ?v= of the address, for an older version. */
    build(id: string, version: string | null): ReturnType<typeof buildView>;
    settings(): ReturnType<typeof builderSettingsView>;
  };
  /** What HQ's own users see about the portal. */
  readonly portalAdmin: {
    access(organizationId: string): ReturnType<typeof portalAccess>;
    updates(projectId: string): ReturnType<typeof projectUpdates>;
    files(projectId: string): ReturnType<typeof clientFiles>;
    fromClients(): ReturnType<typeof clientActivity>;
    waiting(): ReturnType<typeof staffWaiting>;
    calls(): ReturnType<typeof callsWaiting>;
  };
  /** The client portal. Everything here is for the signed-in client's own organization. */
  readonly portal: {
    readonly session: { readonly name: string } | null;
    /** How to reach Potomac. Shown on every portal page, signed in or not. */
    readonly contact: PortalContact;
    /** True when clients are emailed that something is waiting, so the page offers to turn it off. */
    readonly notices: boolean;
    /** The portal's sign-in page when no client is signed in, otherwise null. Every portal page calls it first. */
    guard(): Answer | null;
    home(): ReturnType<typeof portalHome>;
    project(id: string): ReturnType<typeof portalProject>;
    proposal(id: string): ReturnType<typeof portalProposal>;
    /** Whether someone new can sign up to book a call. */
    readonly signUpOpen: boolean;
    /** What a one-time link is for, without using it. */
    link(token: string): { readonly valid: boolean; readonly token: string; readonly email: string; readonly name: string; readonly invite: boolean };
  };
  readonly reports: {
    pipeline(days: string): ReturnType<typeof pipelineReport>;
    projects(): ReturnType<typeof projectHealthReport>;
    budget(): ReturnType<typeof financeOverview>;
  };
  readonly referrals: { list(): ReturnType<typeof referralLinks> };
  /** The Lab's demos, and who opened them (decision 0013, section 8). */
  readonly demos: {
    list(): ReturnType<typeof demosList>;
    forOpportunity(opportunityId: string): OpportunityDemos | null;
  };
  /** Who referred a lead, clients' own links, and referral credit (decision 0013, section 7). */
  readonly referralCredit: {
    referredBy(opportunityId: string): ReturnType<typeof referredByView>;
    forClient(organizationId: string): ClientReferralsView | null;
    forInvoice(invoiceId: string): ReturnType<typeof creditFor>;
    /** What a referral earns, for those who may change it; null for anyone else. */
    amount(): string | null;
    /** The signed-in client's own link and credit. */
    mine(): ClientReferralsView | null;
  };
  /** Reviews and case studies (decision 0013, section 6). */
  readonly showcase: {
    overview(): ReturnType<typeof showcase>;
    forClient(organizationId: string): ReturnType<typeof caseStudyFor>;
    /** The client an emailed review link is for, or null. */
    link(token: string): ReturnType<typeof reviewLink>;
    /** Whether the signed-in client may still write one. */
    mayWrite(): boolean;
  };
  /** n8n automations run for clients (decision 0013, section 5). */
  readonly automations: {
    forClient(organizationId: string): ClientAutomationsView | null;
    all(): ReturnType<typeof allAutomations>;
    /** The signed-in client's. */
    mine(): ReturnType<typeof portalAutomations>;
  };
  /** Monthly reports to plan clients (decision 0013, section 4). */
  readonly clientReports: {
    month(month: string): ReturnType<typeof monthlyReports>;
    detail(id: string): ReturnType<typeof reportDetail>;
    /** The signed-in client's sent reports. */
    portalList(): readonly PortalReportLine[];
    portalOne(id: string): ReturnType<typeof portalReport>;
  };
  /** Free landing pages (decision 0013, section 3). */
  readonly freePages: {
    /** A client's, or null for someone who may not see clients. */
    forClient(organizationId: string): FreePageView | null;
    all(): ReturnType<typeof allFreePages>;
    /** The signed-in client's, or null when signed out. */
    mine(): PortalFreePage | null;
  };
  /** Where leads came from on the website (decision 0013, section 2). */
  readonly leads: {
    /** Where an opportunity came from, or null when the site said nothing. */
    origin(opportunityId: string): LeadOrigin | null;
    sources(days: string): ReturnType<typeof leadSources>;
  };
  /** "Notes from the river" (decision 0013, section 1). */
  readonly newsletter: {
    overview(): ReturnType<typeof newsletterOverview>;
    issue(id: string): ReturnType<typeof issueDetail>;
    /** Whether a confirm or unsubscribe link works, for the page that offers its button. */
    confirmWorks(token: string): boolean;
    unsubscribeWorks(token: string): boolean;
    /** Whether an issue can be sent: email set up, and a mailing address to put in it. */
    readonly ready: { readonly email: boolean; readonly address: boolean };
    /** HQ's own sign-up page, to share. */
    readonly signUpAddress: string;
  };
  /** Website content: a client's own site in the portal, and every site for Potomac's people. */
  readonly websites: {
    /** The signed-in client's site, or null when they have none. `wider` steps the service area map out. */
    mine(wider?: number): ReturnType<typeof portalWebsite>;
    all(): ReturnType<typeof allWebsites>;
    site(id: string, wider?: number): ReturnType<typeof staffWebsite>;
    forClient(id: string): ClientWebsiteView | null;
  };
  readonly monitor: {
    all(): ReturnType<typeof allSites>;
    forClient(id: string): SitesView | null;
    attention(): ReturnType<typeof sitesNeedingAttention>;
  };
  agenda(): TodayView;
  /** Notices (decision 0007, section 8): the bell, the Notices page, Today's new ones, and a task's reminders. */
  /** Webhooks, for admins (decision 0007, section 12). */
  readonly webhooks: {
    list(): ReturnType<typeof listWebhooks>;
    detail(id: string): ReturnType<typeof webhookDetail>;
  };
  readonly bell: {
    unread(): number;
    list(): ReturnType<typeof listNotices>;
    fresh(): ReturnType<typeof unreadNotices>;
    reminders(taskId: string): ReturnType<typeof remindersOn>;
  };
  readonly todos: {
    list(everyone: boolean): Result<TodosView, "forbidden">;
    atClient(id: string): TodosPanel | null;
    onOpportunity(id: string): TodosPanel | null;
    due(): ReturnType<typeof todosDueFor>;
  };
  readonly publicSite: { view(): ReturnType<typeof publicSiteView> };
  readonly renewals: {
    all(): ReturnType<typeof allRenewals>;
    /** A client's, or null when this person may not see them. */
    forClient(id: string): ClientRenewalsView | null;
    comingUp(): ReturnType<typeof renewalsComingUp>;
    /** The signed-in client's renewals that Potomac bills them for. Empty when signed out. */
    mine(): ReturnType<typeof portalRenewals>;
  };
  /** Social media (decision 0010). */
  readonly social: {
    overview(month: string): ReturnType<typeof socialOverview>;
    /** A client's plan and month, or null when this person may not see it or there's no such client. */
    forClient(id: string, month: string): Extract<ReturnType<typeof clientSocial>, { ok: true }>["value"] | null;
    summary(id: string): ReturnType<typeof clientSocialSummary>;
    toDo(): ReturnType<typeof socialToDo>;
    /** The signed-in client's month, or null when they have no plan. */
    mine(month: string): ReturnType<typeof portalSocial>;
    waitingOnMe(): ReturnType<typeof portalSocialWaiting>;
  };
  readonly booking: {
    calls(): ReturnType<typeof callsView>;
    setup(): ReturnType<typeof bookingSetup>;
    weekly(): ReturnType<typeof weeklyGrid>;
    calendarLinks(): ReturnType<typeof calendarLinks>;
    links(): ReturnType<typeof bookingLinks>;
    linkPage(token: string): ReturnType<typeof bookingLinkPage>;
    /** HQ's public address, for links to copy. */
    publicUrl: string;
    invites(): ReturnType<typeof openInvites>;
    invite(id: string): ReturnType<typeof staffInvite> | Promise<null>;
    clientInvites(organizationId: string): ReturnType<typeof clientInvites>;
    /** The signed-in client's open invites to pick times. */
    invitesForMe(): ReturnType<typeof invitesWaitingOn>;
    guestInvite(id: string): ReturnType<typeof guestInvite> | Promise<null>;
    week(week: string | null): ReturnType<typeof weekGrid>;
    next(): ReturnType<typeof nextCalls>;
    /** For the signed-in client: whether they can book, and their calls from now. */
    portal(): { readonly open: boolean; readonly calls: readonly CallLine[] };
    portalTimes(): Promise<OpenTimesView>;
    portalCalls(): readonly CallLine[];
    publicTimes(): Promise<OpenTimesView>;
    /** Open times for someone who already holds a link to their call. */
    manageTimes(): ReturnType<typeof openTimes>;
    publicOpen(): boolean;
    /** Whether email is set up, so the person who books is emailed. */
    readonly emails: boolean;
    /** A call booked from the public page, by its private link. */
    byLink(token: string): CallLine | null;
  };
  readonly people: { list(): ReturnType<typeof listPeople>; twoFactorRule(): { readonly on: boolean; readonly canSet: boolean; readonly yoursOn: boolean } };
  readonly search: (q: string) => ReturnType<typeof search>;
  readonly knowledge: {
    list(query: Record<string, string>): ReturnType<typeof listArticles>;
    article(slug: string): ReturnType<typeof articleDetail>;
    revision(slug: string, number: string): ReturnType<typeof articleRevision>;
  };
  readonly ai: AiPageContext;
  readonly settings: {
    readonly theme: Theme;
    readonly themes: readonly { value: string; label: string }[];
    /** The Today list by email each morning, and whether HQ can send email at all. */
    readonly morningEmail: { readonly on: boolean; readonly emailSetUp: boolean; readonly address: string };
    /** An admin without two-factor sign-in, reminded on the dashboard. */
    readonly remindTwoFactor: boolean;
    readonly twoFactor: { readonly required: boolean; readonly on: boolean; readonly setup: { readonly key: string; readonly link: string; readonly scannable: boolean } | null; readonly recoveryText: string };
  };
};

/** What every module answers a form someone may not use with. */
const NOT_ALLOWED = "You don’t have permission to do that.";

/** An id from an address. Anything that is not one is simply not found. */
/** How far out a service area map is: 0 to 3, from a page's `?wider=`. */
const widerOf = (value: unknown): number => (typeof value === "number" && Number.isInteger(value) ? Math.max(0, Math.min(3, value)) : 0);

function withId<T>(text: string, read: (id: Id) => Result<T, "forbidden" | "not-found">): Result<T, "forbidden" | "not-found"> {
  const id = parseId(text);
  return id.ok ? read(id.value) : err("not-found");
}

const MAX_FORM_BYTES = 16 * 1024;
// Forms that carry a file. Only these addresses accept one, and each has its
// own size limit: the file, plus room for the form's other fields.
const UPLOAD_PATHS = /^\/(tasks\/[0-9a-f-]{36}\/files|projects\/[0-9a-f-]{36}\/(deliverables|expenses|import|ai\/receipt)|proposals\/[0-9a-f-]{36}\/agreement|portal\/projects\/[0-9a-f-]{36}\/files)$/;
// A photo for a website. Smaller than other files: it is shown on a web page.
// A photo or logo for the site builder, shrunk the same way (decision 0010).
const PHOTO_PATHS = /^\/(portal\/website\/photos|websites\/[0-9a-f-]{36}\/photos|builder\/[0-9a-f-]{36}\/images|case-studies\/[0-9a-f-]{36}\/shots)$/;
const MAX_PHOTO_FORM_BYTES = MAX_PHOTO_BYTES + 64 * 1024;
// Forms with long text in them: a proposal's sections, and an article.
const LONG_FORM_PATHS = /^\/(proposals\/[0-9a-f-]{36}|knowledge|articles\/[0-9a-f-]{36}|clients\/import|phone\/[0-9a-f-]{36}\/recap\/ai)$/;
const MAX_LONG_FORM_BYTES = 128 * 1024;
const MAX_UPLOAD_BYTES = MAX_FILE_BYTES + 64 * 1024;

export async function createApp(config: AppConfig): Promise<App> {
  const log = config.log ?? ((message, error) => console.error(message, error ?? ""));
  const { db } = config;

  const services = createServices(db, { emailReady: Boolean(config.email), webhookKey: config.noticeSecret, ...(config.publicUrl ? { publicUrl: config.publicUrl } : {}), ...(config.formOrigins?.[0] ? { siteUrl: new URL(config.formOrigins[0]).origin } : {}), sitePublisher: config.sitePublisher ?? null, aiModel: config.ai ?? null, claude: config.claude ?? null, builderOwner: config.builderOwner ?? null, builderRepos: config.builderRepos ?? null, builderPublishing: config.builderPublishing ?? null, previewSecret: config.noticeSecret, ...(config.runLater ? { runLater: config.runLater } : { runLater: (job: () => Promise<void>) => void job().catch((error: unknown) => log("Site builder: a request failed", error)) }), secure: config.secure, ...(config.passwordCost ? { passwordCost: config.passwordCost } : {}), ...(config.busyCalendar ? { busyCalendar: config.busyCalendar } : {}), ...(config.outsideFetch ? { outsideFetch: config.outsideFetch } : {}) });
  const { session: sessionDeps, crm: crmDeps, dashboard: dashboardDeps, projects: projectsDeps, notes: notesDeps, proposals: proposalsDeps, finance: financeDeps, portal: portalDeps, today } = services;
  const users = sessionDeps.users;
  const contact: PortalContact = config.contact ?? { phone: "", email: "", address: "" };
  // How a client answers a monthly report (decision 0013, section 4).
  const reportContactLine = contact.phone ? `Reply to this email, or call or text ${contact.phone}.` : "Reply to this email.";
  const themes = Object.entries(THEME_LABELS).map(([value, label]) => ({ value, label }));

  const staff = services.staff;
  const sendHtml = (res: ServerResponse, status: number, title: string, body: string) => {
    const html = renderPage(title, body);
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html) });
    res.end(html);
  };
  const { pages, clientOf: clientAddressOf, readNotice, notices } = createHqStaffPages({
    staff,
    secure: config.secure,
    proxies: config.proxies,
    noticeSecret: config.noticeSecret,
    render: (res, title, body) => sendHtml(res, 200, title, body),
  });

  const account = (input: IncomingMessage | string): SignedInAccount | null => {
    const who = staff.session(input);
    return who ? { account: who.account, name: who.name, email: who.email, isOwner: who.roles.includes("owner") } : null;
  };

  // Two-factor sign-in. Someone who has passed the password but not the
  // second step is signed in to the kit, and to nothing in HQ.
  const twoFactorDeps = services.twoFactor;
  const sessionHashOf = (cookieHeader: string) => sessionKeyOf(cookieHeader, staff.cookieName);
  // Five tries a minute: a six-digit code is a small space.
  const secondStepLimit = sqliteRateLimit(db, { name: "second-step", max: 5, windowMs: 60_000 });
  const secondStepDue = (userId: Id, cookieHeader: string) => needsSecondStep(twoFactorDeps, userId, sessionHashOf(cookieHeader));

  // Passkeys are bound to the address the browser says it is on (already
  // checked against the Host header for every post). When HQ's public
  // address is configured, that must be the one: a passkey made at any other
  // address would stop working at the real one.
  const passkeySite = (origin: string | undefined) => {
    try {
      const url = new URL(origin ?? "");
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      const home = config.publicUrl ? new URL(config.publicUrl) : null;
      const pinned = home !== null && home.hostname !== "localhost" && home.hostname !== "127.0.0.1";
      return pinned && home.origin !== url.origin ? null : { rpId: url.hostname, origins: [url.origin] };
    } catch {
      return null;
    }
  };

  const twoFactorView = (actor: Id | null) => {
    const status = actor ? twoFactorStatus(twoFactorDeps, actor) : { on: false, setup: null, recoveryLeft: 0, app: false, passkeys: [] };
    const left = status.recoveryLeft;
    const recoveryText = !status.on ? "" : left === 0 ? "You have no recovery codes left. Make new ones below." : `${left} recovery ${left === 1 ? "code is" : "codes are"} left.`;
    const passkeys = status.passkeys.map((one) => ({ id: one.id, label: one.label, added: services.formatWhen(one.createdAt), used: one.lastUsedAt ? `Last used ${services.formatWhen(one.lastUsedAt)}` : "Not used yet", removable: status.app || status.passkeys.length > 1 }));
    const how = status.app && passkeys.length > 0 ? "a code from your authenticator app, or a passkey" : status.app ? "a code from your authenticator app" : "your passkey";
    return { on: status.on, setup: status.setup, recoveryText, app: status.app, passkeys, how, hasPasskey: passkeys.length > 0 };
  };

  const refusedDeps = services.refused;

  // What pages see of AI (decision 0012): only drafts this person may use.
  const aiDeps = services.ai;
  const money = (dollars: number) => `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const aiContext = (actor: Id | null): AiPageContext => ({
    state: (feature) => (isFeature(feature) ? featureState(aiDeps, actor, feature) : { on: false, why: "" }),
    canManage: actor !== null && authorize(sessionDeps, actor, "ai.manage").ok,
    models: () => modelOptions(aiDeps),
    settings: () => aiSettingsView(aiDeps, actor),
    drafts: () => waitingDrafts(aiDeps, actor, (draft) => describeDraft(aiDeps, draft)),
    draftCount: () => waitingDrafts(aiDeps, actor, () => "").items.length,
    recap(callId) {
      const draft = waitingDraft<RecapDraft>(aiDeps, actor, "call-recap", callId);
      return draft ? { ...draft.content, id: draft.id } : null;
    },
    brief: (bookingId) => callBrief(aiDeps, actor, bookingId as Id),
    deal(opportunityId) {
      const triage = waitingDraft<TriageDraft>(aiDeps, actor, "lead-triage", opportunityId);
      const checkIn = waitingDraft<MailDraft>(aiDeps, actor, "check-in", opportunityId);
      const proposal = waitingDraft<ProposalDraft>(aiDeps, actor, "proposal-draft", opportunityId);
      const total = proposal ? proposal.content.lines.reduce((sum, line) => sum + Math.round(line.quantity * line.rate * 100), 0) / 100 : 0;
      return {
        triage: triage ? { ...triage.content, id: triage.id, serviceLabel: aiDeps.links.services.find((one) => one.key === triage.content.service)?.label ?? "Not sure" } : null,
        checkIn: checkIn ? { ...checkIn.content, id: checkIn.id } : null,
        proposal: proposal ? { ...proposal.content, id: proposal.id, totalText: money(total) } : null,
      };
    },
    project(projectId) {
      const scope = actor !== null && authorize(sessionDeps, actor, "finance.edit").ok ? aiDeps.ai.waitingFor("scope-check", projectId) : [];
      const update = waitingDraft<UpdateDraft>(aiDeps, actor, "weekly-update", projectId);
      return {
        scope: scope.map((draft) => {
          const content = draft.content as ScopeDraft;
          return { ...content, id: draft.id, when: services.formatWhen(draft.createdAt), amountText: content.change ? money(content.change.amount) : "" };
        }),
        update: update ? { ...update.content, id: update.id, when: services.formatWhen(update.createdAt) } : null,
      };
    },
    receipt(projectId) {
      const draft = waitingDraft<ReceiptDraft>(aiDeps, actor, "receipt", projectId);
      return draft ? { ...draft.content, id: draft.id, amountText: draft.content.amount === null ? "" : draft.content.amount.toFixed(2), categories: aiDeps.links.expenseCategories } : null;
    },
    ask() {
      const found = lastAnswer(aiDeps, actor);
      return found ? { ...found.content, when: services.formatWhen(found.createdAt), links: found.content.sources.map((slug) => ({ slug })) } : null;
    },
    marketing: () => marketingQueue(aiDeps, actor),
  });

  const handleStaff = staffRoutes({
    refused: (draft) => recordRefusal(refusedDeps, draft),
    handle: (req, res, url, form) => pages.handle(req, res, url, form),
    session: account,
    clientOf: clientAddressOf,
    allowAttempt: sqliteRateLimit(db, { name: "staff-sign-in", max: config.attemptsPerMinute ?? 10, windowMs: 60_000 }),
    sessionDeps,
    problem: (res, status, title, message) => sendHtml(res, status, title, problemPage({ title, message })),
    log,
  });

  // Pages: Zubra components under src, served by the router. `src/app.zb` is
  // the shell and `src/error.zb` the 404 and 500 page.
  const components = join(import.meta.dirname);
  const zubra = createZubra({ components, inline: false });
  const router = await createRouter({
    zubra,
    components,
    ...(config.cacheDir ? { cacheDir: config.cacheDir } : {}),
    lang: "en",
    // The theme a signed-in person chose. Signed out, the device decides.
    head: ({ request }) => {
      const who = account(request.headers.get("cookie") ?? "");
      const user = who ? users.findByStaffAccount(who.account) : null;
      return `<meta name="robots" content="noindex, nofollow">${themeLinks(user ? users.themeOf(user.id) : "system")}${ICON_LINK}`;
    },
    onError: (error, request) => log(`Page failed: ${request.method} ${new URL(request.url).pathname}`, error),
    context: ({ request }): PageContext => {
      const who = account(request.headers.get("cookie") ?? "");
      const user = who ? establishUser(sessionDeps, who) : null;
      const notice = readNotice(new URL(request.url));
      const signIn = { ...notice, needsOwner: staff.needsOwner(), emailEnabled: Boolean(config.email) };
      const forbidden = () => show("identity/ui/no-access", { title: "No access" }, { status: 403 });
      const date = today();
      const client = clientSession(portalDeps, request.headers.get("cookie") ?? "");
      const pending = user !== null && secondStepDue(user.id, request.headers.get("cookie") ?? "");
      // Past the password and any code, but an admin who must turn on two-factor
      // sign-in first: Settings only, to do that.
      const setupActor = pending ? null : (user?.id ?? null);
      const enrolling = mustTurnOnTwoFactor(twoFactorDeps, setupActor);
      const actor = enrolling ? null : setupActor;
      const missing = <T,>(): Result<T, "not-found"> => err("not-found");
      return {
        portalAdmin: {
          access: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? portalAccess(portalDeps, actor, parsed.value) : { canView: false, canManage: false, users: [], calls: [], canRespond: false };
          },
          updates: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? projectUpdates(portalDeps, actor, parsed.value) : { canView: false, canPost: false, items: [] };
          },
          files: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? clientFiles(portalDeps, actor, parsed.value) : { canView: false, items: [] };
          },
          fromClients: () => clientActivity(portalDeps, actor),
          waiting: () => staffWaiting(portalDeps, actor),
          calls: () => callsWaiting(portalDeps, actor),
        },
        portal: {
          session: client ? { name: client.name } : null,
          contact,
          notices: config.clientNotices === true && config.email !== undefined && config.email !== null,
          guard: () => (client ? null : show("portal/ui/portal-sign-in-page", { ...notice, title: "Sign in" }, { status: 401 })),
          // Each of these is given the session and nothing else to decide whose records to read.
          home: () => portalHome(portalDeps, client as NonNullable<typeof client>),
          project: (id) => {
            const parsed = parseId(id);
            return client && parsed.ok ? portalProject(portalDeps, client, parsed.value) : missing();
          },
          proposal: (id) => {
            const parsed = parseId(id);
            return client && parsed.ok ? portalProposal(portalDeps, client, parsed.value) : missing();
          },
          signUpOpen: signUpOpen(),
          link: (token) => {
            const found = /^[A-Za-z0-9_-]{43}$/.test(token) ? portalDeps.auth.peek(token) : null;
            const user = found ? portalDeps.clientUsers.byEmail(found.email) : null;
            return found && user && user.status !== "disabled" ? { valid: true, token, email: found.email, name: user.name, invite: found.kind === "invite" } : { valid: false, token: "", email: "", name: "", invite: false };
          },
        },
        signedIn: who !== null && !pending,
        user: user && !pending ? { id: user.id, name: user.name } : null,
        notice,
        signIn,
        today: date,
        todayLabel: Temporal.PlainDate.from(date).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" }),
        guard: () =>
          who === null
            ? show("identity/ui/sign-in-page", { ...signIn, title: "Sign in" }, { status: 401 })
            : user === null
              ? forbidden()
              : pending
                ? show("identity/ui/two-factor-page", { problem: notice.problem, title: "Confirm it’s you", app: twoFactorView(user.id).app, passkey: twoFactorView(user.id).hasPasskey }, { status: 401 })
                : enrolling && new URL(request.url).pathname !== "/settings"
                  ? show("identity/ui/two-factor-required-page", { title: "Turn on two-factor sign-in" }, { status: 403 })
                  : null,
        forbidden,
        dashboard: { recentActivity: () => recentActivity(dashboardDeps, actor), audit: (query) => auditHistory(services.audit, actor, query), refused: () => refusedAttempts(refusedDeps, actor) },
        crm: {
          clientTouches: (id) => {
            const parsed = parseId(id);
            const view = parsed.ok ? clientTouches(services.touches, actor, parsed.value) : null;
            return view?.ok ? view.value : null;
          },
          opportunityTouches: (id) => {
            const parsed = parseId(id);
            const view = parsed.ok ? opportunityTouches(services.touches, actor, parsed.value) : null;
            return view?.ok ? view.value : null;
          },
          callScreen: (id) => {
            const parsed = parseId(id);
            const view = parsed.ok ? callScreen(services.calls, actor, parsed.value) : null;
            return view?.ok ? view.value : null;
          },
          openCall: () => openCall(services.calls, actor),
          callGuides: () => {
            const view = callGuides(services.calls, actor);
            return view.ok ? view.value : null;
          },
          voicemailScript: () => {
            const view = voicemailScript(services.calls, actor);
            return view.ok ? view.value : null;
          },
          callsToMake: () => callsToMake(services.calls, actor),
          comingUp: () => comingUp(services.calls, actor),
          recap: (id) => {
            const parsed = parseId(id);
            const view = parsed.ok ? recapFor(services.calls, actor, parsed.value) : null;
            return view?.ok ? view.value : view && !view.ok && view.error === "no-email" ? "no-email" : null;
          },
          emailOn: Boolean(config.email),
          getReady: (id) => {
            const parsed = parseId(id);
            const view = parsed.ok ? getReady(services.calls, actor, parsed.value) : null;
            return view?.ok ? view.value : null;
          },
          inquiryServices: () => SERVICE_OPTIONS,
          listClients: (status, demo) => listClients(crmDeps, actor, { status: status ?? "", kind: demo ?? "" }),
          canImport: () => mayImport(crmDeps, actor),
          pipeline: () => pipeline(crmDeps, actor, date),
          clientDetail: (id) => withId(id, (clientId) => clientDetail(crmDeps, actor, clientId)),
          opportunityDetail: (id) => withId(id, (opportunityId) => opportunityDetail(crmDeps, actor, opportunityId, date)),
          followUpsDue: () => followUpsDue(crmDeps, actor, date),
        },
        projects: {
          list: (status) => listProjects(projectsDeps, actor, { status: status ?? "" }),
          overview: (id) => withId(id, (projectId) => projectOverview(projectsDeps, actor, projectId)),
          links: (id) => {
            const parsed = parseId(id);
            const view = parsed.ok ? projectLinks(projectsDeps, actor, parsed.value) : null;
            return view?.ok ? view.value : null;
          },
          tasks: (id) => withId(id, (projectId) => projectTasks(projectsDeps, actor, projectId)),
          board: (id, mine) => (id === "" ? board(projectsDeps, actor, { mine }) : withId(id, (projectId) => board(projectsDeps, actor, { projectId, mine }))),
          task: (id) => withId(id, (taskId) => taskDetail(projectsDeps, actor, taskId)),
          labels: () => labelsPage(projectsDeps, actor),
          work: (params) => workTable(projectsDeps, actor, params),
          pinned: () => pinnedFilters(projectsDeps, actor),
          timeline: (id) => withId(id, (projectId) => projectTimeline(projectsDeps, actor, projectId)),
          timelines: () => projectsTimeline(projectsDeps, actor),
          calendar: () => calendarFeedView(projectsDeps, actor),
          shares: (projectId) => {
            const parsed = parseId(projectId);
            return parsed.ok ? shareLinks(projectsDeps, actor, parsed.value) : { canShare: false, links: [] };
          },
          shared: (token) => sharedProject(projectsDeps, token),
          canImport: () => canImportTasks(projectsDeps, actor),
          importPreview: (id) => withId(id, (importId) => taskImportPreview(projectsDeps, actor, importId)),
          quickAdd: (params) => {
            const added = parseId(params("added")[0] ?? "");
            return { view: quickAddPreview(projectsDeps, actor, { text: params("text")[0] ?? "", skip: readSkip(params("skip")) }), added: added.ok ? `/tasks/${added.value}` : "" };
          },
          active: () => activeProjects(projectsDeps, actor),
          deadlines: () => upcomingDeadlines(projectsDeps, actor),
        },
        notes: {
          list: (recordType, recordId) => {
            const id = parseId(recordId);
            return id.ok ? listNotes(notesDeps, actor, recordType, id.value) : { recordType, recordId, canAdd: false, items: [] };
          },
        },
        proposals: {
          list: () => listProposals(proposalsDeps, actor),
          detail: (id) => withId(id, (proposalId) => proposalDetail(proposalsDeps, actor, proposalId)),
          version: (id, number) => withId(id, (proposalId) => proposalVersion(proposalsDeps, actor, proposalId, /^\d{1,4}$/.test(number) ? Number(number) : Number.NaN)),
          forOpportunity: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? proposalsFor(proposalsDeps, actor, parsed.value) : { canView: false, canStart: false, templates: [], suggested: "blank", items: [] };
          },
        },
        time: {
          sheet: (week, everyone) => timeSheet(financeDeps, actor, { week, everyone }),
          forTask: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? taskTime(financeDeps, actor, parsed.value) : { can: false, logged: "0", running: false, since: "" };
          },
          thisWeek: () => hoursThisWeek(financeDeps, actor),
        },
        money: {
          reminders: () => ({ on: services.invoiceReminders.reminders.on(), canEdit: actor !== null && authorize(sessionDeps, actor, "finance.edit").ok, email: Boolean(config.email) }),
          invoiceReminders: (id) => withId(id, (invoiceId) => invoiceReminders(services.invoiceReminders, actor, invoiceId)),
          recurring: () => recurringOverview(financeDeps, actor),
          profit: (year) => profitAndLoss(financeDeps, actor, year),
          overview: () => financeOverview(financeDeps, actor),
          project: (id) => withId(id, (projectId) => projectMoney(financeDeps, actor, projectId)),
          changes: (id) => withId(id, (projectId) => projectChanges(financeDeps, actor, projectId)),
          overBudget: () => projectsOverBudget(financeDeps, actor),
          invoice: (id) => withId(id, (invoiceId) => invoiceDetail(financeDeps, actor, invoiceId)),
          invoices: (show) => invoicesOverview(financeDeps, actor, show),
          forClient: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? clientInvoices(financeDeps, actor, parsed.value) : null;
          },
        },
        can: { proposals: authorize(sessionDeps, actor, "proposal.view").ok, money: authorize(sessionDeps, actor, "finance.view").ok, time: authorize(sessionDeps, actor, "time.log").ok, audit: authorize(sessionDeps, actor, "activity.view-all").ok, reports: authorize(sessionDeps, actor, "report.view").ok, todos: authorize(sessionDeps, actor, "task.view").ok, add: authorize(sessionDeps, actor, "task.edit").ok, calls: authorize(sessionDeps, actor, "call.respond").ok, people: authorize(sessionDeps, actor, "user.view").ok, publicSite: authorize(sessionDeps, actor, "public-site.view").ok, referrals: authorize(sessionDeps, actor, "referral.manage").ok, webhooks: authorize(sessionDeps, actor, "webhook.manage").ok, social: authorize(sessionDeps, actor, "social.view").ok, siteBuilder: authorize(sessionDeps, actor, "site.build").ok, newsletter: authorize(sessionDeps, actor, "newsletter.manage").ok, monthlyReports: authorize(sessionDeps, actor, "client-report.send").ok, reviews: authorize(sessionDeps, actor, "review.manage").ok, demos: authorize(sessionDeps, actor, "demo.manage").ok },
        builder: {
          list: () => buildsView(services.builder, actor),
          build: (id, version) => withId(id, (buildId) => buildView(services.builder, actor, buildId, version === null ? null : /^\d{1,6}$/.test(version) ? Number(version) : Number.NaN)),
          settings: () => builderSettingsView(services.builder, actor),
        },
        websites: {
          mine: (wider) => portalWebsite(services.websites, client, widerOf(wider)),
          all: () => allWebsites(services.websites, actor),
          site: (id, wider) => withId(id, (parsed) => staffWebsite(services.websites, actor, parsed, widerOf(wider))),
          forClient: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? clientWebsite(services.websites, actor, parsed.value) : null;
          },
        },
        referrals: { list: () => referralLinks(services.referrals, actor, (config.publicUrl ?? "").replace(/\/$/, "")) },
        demos: {
          list: () => demosList(services.demos, actor),
          forOpportunity: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? opportunityDemos(services.demos, actor, parsed.value) : null;
          },
        },
        referralCredit: {
          referredBy: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? referredByView(services.referralCredit, actor, parsed.value) : null;
          },
          forClient: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? clientReferrals(services.referralCredit, actor, parsed.value, (config.publicUrl ?? "").replace(/\/$/, "")) : null;
          },
          forInvoice: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? creditFor(services.referralCredit, actor, parsed.value) : null;
          },
          amount: () => creditAmount(services.referralCredit, actor),
          mine: () => portalReferrals(services.referralCredit, client?.organizationId ?? null, (config.publicUrl ?? "").replace(/\/$/, "")),
        },
        showcase: {
          overview: () => showcase(services.showcase, actor),
          forClient: (id) => withId(id, (organizationId) => caseStudyFor(services.showcase, actor, organizationId)),
          link: (token) => reviewLink(services.showcase, token),
          mayWrite: () => mayWriteReview(services.showcase, client?.organizationId ?? null),
        },
        automations: {
          forClient: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? clientAutomations(services.automations, actor, parsed.value) : null;
          },
          all: () => allAutomations(services.automations, actor),
          mine: () => portalAutomations(services.automations, client?.organizationId ?? null),
        },
        clientReports: {
          month: (month) => monthlyReports(services.clientReports, actor, month),
          detail: (id) => withId(id, (reportId) => reportDetail(services.clientReports, actor, reportId, reportContactLine)),
          portalList: () => portalReports(services.clientReports, client?.organizationId ?? null),
          portalOne: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? portalReport(services.clientReports, client?.organizationId ?? null, parsed.value) : null;
          },
        },
        freePages: {
          forClient: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? clientFreePage(services.freePages, actor, parsed.value) : null;
          },
          all: () => allFreePages(services.freePages, actor),
          mine: () => portalFreePage(services.freePages, client),
        },
        leads: {
          origin: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? leadOrigin(services.leads, actor, parsed.value) : null;
          },
          sources: (days) => leadSources(services.leads, actor, days),
        },
        newsletter: {
          overview: () => newsletterOverview(services.newsletter, actor),
          issue: (id) => withId(id, (issueId) => issueDetail(services.newsletter, actor, issueId)),
          confirmWorks: (token) => confirmLinkWorks(services.newsletter, token),
          unsubscribeWorks: (token) => unsubscribeLinkWorks(services.newsletter, token),
          ready: { email: Boolean(config.email), address: contact.address !== "" },
          signUpAddress: `${(config.publicUrl ?? "").replace(/\/$/, "")}/river`,
        },
        reports: {
          pipeline: (days) => pipelineReport(crmDeps, actor, date, /^\d{1,3}$/.test(days) ? Number(days) : 90),
          projects: () => projectHealthReport(projectsDeps, actor),
          budget: () => (authorize(sessionDeps, actor, "report.view").ok ? financeOverview(financeDeps, actor) : err("forbidden")),
        },
        monitor: {
          all: () => allSites(services.monitor, actor),
          forClient: (id) => {
            const parsed = parseId(id);
            const view = parsed.ok ? clientSites(services.monitor, actor, parsed.value) : null;
            return view?.ok ? view.value : null;
          },
          attention: () => sitesNeedingAttention(services.monitor, actor),
        },
        agenda: () => todayFor(services.day, actor),
        webhooks: {
          list: () => listWebhooks(services.webhooks, actor, services.formatWhen),
          detail: (id) => withId(id, (webhookId) => webhookDetail(services.webhooks, actor, webhookId, services.formatWhen)),
        },
        bell: {
          unread: () => unreadCount(services.notices, actor),
          list: () => listNotices(services.notices, actor, services.formatWhen),
          fresh: () => unreadNotices(services.notices, actor, services.formatWhen),
          reminders: (taskId) => {
            const parsed = parseId(taskId);
            return parsed.ok ? remindersOn(services.notices, actor, parsed.value, services.formatWhen) : [];
          },
        },
        todos: {
          list: (everyone) => listTodos(services.todos, actor, { everyone }),
          atClient: (id) => {
            const parsed = parseId(id);
            const view = parsed.ok ? todosAt(services.todos, actor, { clientId: parsed.value }) : null;
            return view?.ok ? view.value : null;
          },
          onOpportunity: (id) => {
            const parsed = parseId(id);
            const view = parsed.ok ? todosAt(services.todos, actor, { opportunityId: parsed.value }) : null;
            return view?.ok ? view.value : null;
          },
          due: () => todosDueFor(services.todos, actor),
        },
        publicSite: { view: () => publicSiteView(services.publicSite, actor) },
        renewals: {
          all: () => allRenewals(services.renewals, actor),
          forClient: (id) => {
            const parsed = parseId(id);
            const view = parsed.ok ? clientRenewals(services.renewals, actor, parsed.value) : null;
            return view?.ok ? view.value : null;
          },
          comingUp: () => renewalsComingUp(services.renewals, actor),
          mine: () => (client ? portalRenewals(services.renewals, client.organizationId) : []),
        },
        social: {
          overview: (month) => socialOverview(services.social, actor, month),
          forClient: (id, month) => {
            const parsed = parseId(id);
            const view = parsed.ok ? clientSocial(services.social, actor, parsed.value, month) : null;
            return view?.ok ? view.value : null;
          },
          summary: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? clientSocialSummary(services.social, actor, parsed.value) : null;
          },
          toDo: () => socialToDo(services.social, actor),
          mine: (month) => portalSocial(services.social, client, month),
          waitingOnMe: () => portalSocialWaiting(services.social, client),
        },
        booking: {
          calls: () => callsView(services.booking, actor),
          setup: () => bookingSetup(services.booking, actor),
          weekly: () => weeklyGrid(services.booking, actor),
          calendarLinks: () => calendarLinks(services.sources, actor),
          links: () => bookingLinks(services.links, actor),
          linkPage: (token) => bookingLinkPage(services.links, token),
          publicUrl: (config.publicUrl ?? "").replace(/\/$/, ""),
          invites: () => openInvites(services.invites, actor),
          invite: (id) => {
            const parsed = parseId(id);
            return parsed.ok ? staffInvite(services.invites, actor, parsed.value) : Promise.resolve(null);
          },
          clientInvites: (organizationId) => {
            const parsed = parseId(organizationId);
            return parsed.ok ? clientInvites(services.invites, actor, parsed.value) : [];
          },
          invitesForMe: () => (client ? invitesWaitingOn(services.invites, client.organizationId) : []),
          guestInvite: (id) => {
            const parsed = parseId(id);
            return client && parsed.ok ? guestInvite(services.invites, client, parsed.value) : Promise.resolve(null);
          },
          week: (week) => weekGrid(services.booking, actor, week),
          next: () => nextCalls(services.booking, actor),
          // Each of these reads only the signed-in client's organization.
          portal: () => ({ open: client !== null && bookingOpen(services.booking, "portal"), calls: client ? callsForClient(services.booking, client.organizationId) : [] }),
          portalTimes: () => (client ? openTimes(services.booking, "portal") : Promise.resolve({ open: false, callMinutes: 0, days: [], calendarFailed: false })),
          portalCalls: () => (client ? callsForClient(services.booking, client.organizationId) : []),
          publicTimes: () => openTimes(services.booking, "public"),
          manageTimes: () => openTimes(services.booking, "link"),
          publicOpen: () => bookingOpen(services.booking, "public"),
          emails: Boolean(config.email),
          byLink: (token) => {
            const found = bookingByLink(services.booking, token);
            return found ? callLine(services.booking, found) : null;
          },
        },
        people: {
          list: () => listPeople(sessionDeps, actor, (id) => twoFactorDeps.twoFactor.get(id)?.confirmed === true),
          twoFactorRule: () => ({ on: twoFactorDeps.twoFactor.requiredForAdmins(), canSet: authorize(sessionDeps, actor, "user.set-roles").ok, yoursOn: actor !== null && twoFactorDeps.twoFactor.get(actor)?.confirmed === true }),
        },
        search: (q) => search(services.search, actor, q),
        knowledge: {
          list: (query) => listArticles(services.knowledge, actor, query),
          article: (slug) => articleDetail(services.knowledge, actor, slug),
          revision: (slug, number) => articleRevision(services.knowledge, actor, slug, /^\d{1,6}$/.test(number) ? Number(number) : Number.NaN),
        },
        ai: aiContext(actor),
        settings: { theme: actor ? users.themeOf(actor) : "system", themes, morningEmail: { on: actor ? users.morningEmailOf(actor) : false, emailSetUp: Boolean(config.email), address: user?.email ?? "" }, twoFactor: { ...twoFactorView(setupActor), required: enrolling }, remindTwoFactor: shouldTurnOnTwoFactor(twoFactorDeps, actor) },
      };
    },
  });

  // Form posts. A page's own forms only: the browser must say the post came
  // from this site (Origin), it must be a form, and it must be small.
  const actorOf = (cookieHeader: string): Id | null => {
    const who = account(cookieHeader);
    const user = who ? establishUser(sessionDeps, who) : null;
    return user && !secondStepDue(user.id, cookieHeader) && !mustTurnOnTwoFactor(twoFactorDeps, user.id) ? user.id : null;
  };
  // The same, but also an admin who must turn on two-factor sign-in: for the forms that do that.
  const setupActorOf = (cookieHeader: string): Id | null => {
    const who = account(cookieHeader);
    const user = who ? establishUser(sessionDeps, who) : null;
    return user && !secondStepDue(user.id, cookieHeader) ? user.id : null;
  };
  // "Forgot your password?" by email, when email is set up.
  const email = config.email ?? null;
  const resetMail = email
    ? createNotify({
        send: email.send,
        templates: {
          "password-reset": ({ name, link }: { name: string; link: string }) => ({
            subject: "Set a new password for Potomac HQ",
            body: `Hi ${name},\n\nSomeone asked to set a new password for your Potomac HQ account. If it was you, open this link. It works once:\n\n${link}\n\nIf it wasn't you, ignore this email. Your password has not changed.\n\nPotomac Solutions`,
          }),
        },
      })
    : null;
  const requestReset = resetMail && email
    ? (address: string) =>
        requestPasswordReset(
          {
            ...sessionDeps,
            publicUrl: email.publicUrl,
            log,
            accounts: {
              findActive: (wanted) => {
                const one = staff.list().find((person) => person.email === wanted && !person.disabled);
                return one ? { account: one.account, name: one.name } : null;
              },
              issueReset: async (target) => {
                const owner = staff.list().find((person) => person.roles.includes("owner") && !person.disabled);
                if (!owner) return null;
                const made = await staff.resetLink({ account: owner.account }, target);
                return made.ok ? made.token : null;
              },
            },
            mail: async (to, message) => "ok" in (await resetMail.notify({ email: to }, "password-reset", message)),
          },
          address,
        )
    : null;

  // Other sites whose forms may post here: the inquiry form and the newsletter sign-up.
  const formOrigins = (config.formOrigins ?? []).map((one) => new URL(one).origin);
  // The newsletter's confirm link (decision 0013, section 1), when email is set up.
  const confirmNewsletter: ConfirmMail | null = email
    ? async (to, link) =>
        "ok" in
        (await email.send({
          channel: "email",
          to: to.email,
          subject: "Confirm your subscription to Notes from the river",
          body: `Hi${to.name ? ` ${to.name}` : ""},\n\nSomeone, probably you, asked to get Notes from the river, the newsletter from Potomac Solutions. Open this link and press Confirm to start. It works for a week:\n\n${link}\n\nIf it wasn't you, ignore this email and you won't hear from us.\n\nMikey and Jayanti\nPotomac Solutions`,
        }))
    : null;
  const newsletterPerEmail = sqliteRateLimit(db, { name: "newsletter-email", max: 3, windowMs: 24 * 60 * 60_000 });
  const forms = new Hono<{ Bindings: { incoming: IncomingMessage } }>();
  // A form someone signed in was not allowed to use is written down (security
  // review, gap 4). Every module refuses with the same words, so this one
  // check covers every form, however its handler is written.
  forms.use("*", async (c, next) => {
    await next();
    if (c.req.method !== "POST" || c.res.status !== 303) return;
    const location = c.res.headers.get("location") ?? "";
    if (new URL(location, "http://hq.invalid").searchParams.get("problem") !== NOT_ALLOWED) return;
    const actor = actorOf(c.req.header("cookie") ?? "");
    if (actor) recordRefusal(refusedDeps, { kind: "permission", userId: actor, address: clientAddressOf(c.env.incoming), detail: `POST ${c.req.path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id")}` });
  });
  forms.route("/", crmRoutes({ crm: crmDeps, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", importRoutes({ clientImport: services.clientImport, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", projectRoutes({ projects: projectsDeps, actorOf, sign: (location) => notices.sign(location), feedPage: (view) => renderPage("Your calendar address", feedAddressPage(view)), sharePage: (view) => renderPage("Your share link", shareAddressPage(view)), ...(config.publicUrl ? { publicUrl: config.publicUrl } : {}) }));
  forms.route("/", proposalRoutes({ proposals: proposalsDeps, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", financeRoutes({ finance: financeDeps, reminders: services.invoiceReminders, actorOf, sign: (location) => notices.sign(location) }));
  const clientOf = (cookieHeader: string) => clientSession(portalDeps, cookieHeader);
  const bookerOf = (cookieHeader: string): PortalBooker | null => {
    const session = clientOf(cookieHeader);
    const user = session ? portalDeps.clientUsers.get(session.clientUserId) : null;
    return session && user ? { organizationId: session.organizationId, clientUserId: session.clientUserId, name: user.name, email: user.email } : null;
  };
  const publicUrl = (config.publicUrl ?? "").replace(/\/$/, "");
  /** Who a lead from the website belongs to: whoever takes calls, or else an admin. */
  const leadOwner = (): Id | null => {
    const host = services.booking.bookings.settings()?.hostId;
    if (host && users.get(host)?.status === "active") return host;
    return users.list().find((one) => one.status === "active" && users.rolesOf(one.id).includes("admin"))?.id ?? null;
  };
  /** Anyone can sign up to book when booking for new people is on and HQ can email the confirm link. */
  const signUpOpen = (): boolean => inviteMail !== null && services.booking.bookings.settings()?.publicOpen === true && (services.booking.bookings.settings()?.hours.length ?? 0) > 0;
  /** How someone reaches Potomac about an email they didn't expect: " by calling or texting …", or by email, or by replying. */
  const contactLine = contact.phone ? ` by calling or texting ${contact.phone}` : contact.email ? ` at ${contact.email}` : " by replying to this email";
  const inviteMail = email
    ? createNotify({
        send: email.send,
        templates: {
          "hq-invite": ({ name, link }: { name: string; link: string }) => ({
            subject: "You are invited to Potomac HQ",
            body: `Hi ${name},\n\nYou have been invited to Potomac HQ. Open this link to choose your password. It works once, for a week:\n\n${link}\n\nPotomac Solutions`,
          }),
          "hq-reset": ({ name, link }: { name: string; link: string }) => ({
            subject: "Set a new password for Potomac HQ",
            body: `Hi ${name},\n\nAn administrator made you a link to set a new password for Potomac HQ. It works once, for a week:\n\n${link}\n\nPotomac Solutions`,
          }),
          "sign-up": ({ name, link }: { name: string; link: string }) => ({
            subject: "Confirm your email to book a call with Potomac Solutions",
            body: `Hi ${name},\n\nThanks for signing up. Open this link to confirm your email and choose a password. It works once, for a week:\n\n${link}\n\nThen choose a time for your call. You can move or cancel it in your client portal.\n\nIf you didn't sign up, ignore this email and nothing happens.\n\nPotomac Solutions`,
          }),
          "sign-up-again": ({ name, link }: { name: string; link: string }) => ({
            subject: "Your Potomac Solutions client portal",
            body: `Hi ${name},\n\nSomeone, probably you, tried to sign up with this email. You already have a client portal account. Sign in as usual, or open this link to choose a new password. It works once, for a week:\n\n${link}\n\nIf it wasn't you, ignore this email and nothing changes.\n\nPotomac Solutions`,
          }),
          "website-booked": ({ name, link, when }: { name: string; link: string; when: string }) => ({
            subject: "Your call with Potomac Solutions is booked",
            body: `Hi ${name},\n\nThanks for booking a call with us for ${when}. We also made you a client account, so everything about your call and your website lives in one place.\n\nOpen this link to choose a password and see your dashboard. There you can add or change your details, and move or cancel your call. It works once, for a week:\n\n${link}\n\nIf you didn't book this, someone used your email address on our website. Please let us know${contactLine}, and we'll cancel the call and close the account.\n\nPotomac Solutions`,
          }),
          "website-booking-again": ({ name, link }: { name: string; link: string }) => ({
            subject: "Someone tried to book a call with your details",
            body: `Hi ${name},\n\nSomeone just tried to book a free call on the Potomac Solutions website using your email address or phone number. You already have an account with us, so we didn't book a second free call.\n\nIf it was you, open this link to sign in (or choose a new password) and book from your dashboard. It works once, for a week:\n\n${link}\n\nIf it wasn't you, please let us know${contactLine}. Nothing has been booked or changed, and nobody can use this link without access to this inbox.\n\nPotomac Solutions`,
          }),
          "portal-link": ({ name, link }: { name: string; link: string }) => ({
            subject: "Your Potomac Solutions client portal",
            body: `Hi ${name},\n\nPotomac Solutions has set up a client portal for you. Open this link to choose your password. It works once, for a week:\n\n${link}\n\nIn the portal you can follow your project, approve work and send messages.\n\nPotomac Solutions`,
          }),
        },
      })
    : null;
  forms.route(
    "/",
    staffPortalRoutes({
      portal: portalDeps,
      actorOf,
      sign: (location) => notices.sign(location),
      publicUrl,
      mailLink: inviteMail ? async (to, link) => "ok" in (await inviteMail.notify({ email: to.email }, "portal-link", { name: to.name, link })) : null,
      linkPage: (view) => renderPage("Send this link", linkPage(view)),
    }),
  );
  forms.route(
    "/",
    clientPortalRoutes({
      portal: portalDeps,
      clientOf,
      sign: (location) => notices.sign(location),
      addressOf: (incoming) => clientAddressOf(incoming as IncomingMessage),
      allowAttempt: sqliteRateLimit(db, { name: "portal-sign-in", max: config.attemptsPerMinute ?? 10, windowMs: 60_000 }),
      refusedSignIn: (address, from) => recordRefusal(refusedDeps, { kind: "portal-sign-in", email: address, address: from, detail: "refused" }),
      ...(inviteMail
        ? {
            signUp: {
              open: signUpOpen,
              ownerFor: leadOwner,
              publicUrl,
              mail: async (to, link, kind) => "ok" in (await inviteMail.notify({ email: to.email }, kind === "reset" ? "sign-up-again" : "sign-up", { name: to.name, link })),
              allowPerAddress: sqliteRateLimit(db, { name: "sign-up-address", max: 5, windowMs: 60 * 60_000 }),
              allowPerEmail: sqliteRateLimit(db, { name: "sign-up-email", max: 3, windowMs: 24 * 60 * 60_000 }),
            },
          }
        : {}),
    }),
  );
  forms.route("/", noteRoutes({ notes: notesDeps, actorOf, sign: (location) => notices.sign(location) }));
  forms.route(
    "/",
    peopleRoutes({
      people: sessionDeps,
      actorOf,
      sign: (location) => notices.sign(location),
      publicUrl,
      mailLink: inviteMail ? async (to, link, kind) => "ok" in (await inviteMail.notify({ email: to.email }, kind === "invite" ? "hq-invite" : "hq-reset", { name: to.name, link })) : null,
      linkPage: (view) => renderPage("Send this link", userLinkPage(view)),
    }),
  );
  forms.route("/", knowledgeRoutes({ knowledge: services.knowledge, actorOf, sign: (location) => notices.sign(location) }));
  forms.route(
    "/",
    twoFactorRoutes({
      twoFactor: twoFactorDeps,
      actorOf,
      setupActorOf,
      pendingOf: (cookieHeader) => {
        const who = account(cookieHeader);
        const user = who ? establishUser(sessionDeps, who) : null;
        const sessionHash = sessionHashOf(cookieHeader);
        return user && sessionHash && secondStepDue(user.id, cookieHeader) ? { userId: user.id, sessionHash } : null;
      },
      sessionOf: sessionHashOf,
      siteOf: passkeySite,
      allowAttempt: secondStepLimit,
      addressOf: (incoming) => clientAddressOf(incoming as IncomingMessage),
      sign: (location) => notices.sign(location),
      codesPage: (codes, fresh, withPasskey) => renderPage("Your recovery codes", recoveryCodesPage(codes, fresh, withPasskey)),
      refused: (draft) => recordRefusal(refusedDeps, draft),
    }),
  );
  // Emails about booked calls, when email is set up.
  const bookingEmails = email
    ? {
        mail: async (message: { to: string; subject: string; body: string }) => "ok" in (await email.send({ channel: "email", ...message })),
        options: { publicUrl: (config.publicUrl ?? email.publicUrl ?? "").replace(/\/$/, ""), phone: contact.phone },
        log,
      }
    : null;
  // The inquiry form, from /contact or Potomac's website.
  forms.route(
    "/",
    inquiryRoutes({
      crm: services.crm,
      ownerFor: leadOwner,
      sign: (location) => notices.sign(location),
      addressOf: (incoming) => clientAddressOf(incoming as IncomingMessage),
      allowPerAddress: sqliteRateLimit(db, { name: "inquiry-address", max: 5, windowMs: 60 * 60_000 }),
      allowPerEmail: sqliteRateLimit(db, { name: "inquiry-email", max: 3, windowMs: 24 * 60 * 60_000 }),
      returnOrigins: formOrigins,
      // Where on the website they were (decision 0013, section 2).
      attribute: (opportunityId, read) => void keepLeadTouch(services.leads, { opportunityId }, touchFields(read)),
      // An inquiry that came by a referral link is counted for that link.
      credit: (code, opportunityId) => {
        // Counted for the link; and, for a client's own link, marked as referred by them (decision 0013).
        if (creditInquiry(services.referrals, code, opportunityId)) markReferredByLink(services.referralCredit, opportunityId);
      },
      notify: async (inquiry) => {
        const to = config.inquiryEmail;
        if (!email || !to) return;
        const lines = [`${inquiry.name}${inquiry.business ? ` (${inquiry.business})` : ""} sent an inquiry${inquiry.known ? ". They're already in the CRM" : ""}.`, "", `${inquiry.email}${inquiry.phone ? ` · ${inquiry.phone}` : ""}`, "", inquiry.message, "", `In HQ: ${(config.publicUrl ?? email.publicUrl ?? "").replace(/\/$/, "")}/opportunities/${inquiry.opportunityId}`];
        const sent = await email.send({ channel: "email", to, subject: `Inquiry from ${inquiry.business || inquiry.name}`, body: lines.join("\n") });
        if (!("ok" in sent)) log("Inquiry: the email to Potomac could not be sent");
      },
    }),
  );
  const publicBooking = bookingPublicRoutes({
    booking: services.booking,
    emails: bookingEmails,
    sign: (location) => notices.sign(location),
  });
  forms.route("/", publicBooking);
  forms.route("/", linkRoutes({ links: services.links, emails: bookingEmails, actorOf, sign: (location) => notices.sign(location), allowAttempt: sqliteRateLimit(db, { name: "link-booking", max: 10, windowMs: 60 * 60_000 }), addressOf: (incoming) => clientAddressOf(incoming as IncomingMessage) }));
  forms.route("/", bookingPortalRoutes({ booking: services.booking, emails: bookingEmails, bookerOf, sign: (location) => notices.sign(location) }));
  forms.route("/", touchRoutes({ touches: services.touches, actorOf, sign: (location) => notices.sign(location) }));
  // The recap email after a call (decision 0009, section 7), when email is set up.
  const recapMail = email ? async (message: { to: string; subject: string; body: string }) => "ok" in (await email.send({ channel: "email", ...message })) : null;
  forms.route("/", callRoutes({ calls: services.calls, mail: recapMail, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", aiRoutes({ ai: services.ai, mail: recapMail, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", monitorRoutes({ monitor: services.monitor, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", websiteStaffRoutes({ websites: services.websites, actorOf, clientOf, sign: (location) => notices.sign(location) }));
  forms.route("/", websitePortalRoutes({ websites: services.websites, actorOf, clientOf, sign: (location) => notices.sign(location) }));
  forms.route("/", referralRoutes({ referrals: services.referrals, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", freePageStaffRoutes({ freePages: services.freePages, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", freePagePortalRoutes({ freePages: services.freePages, clientOf, sign: (location) => notices.sign(location) }));
  forms.route("/", renewalPortalRoutes({ renewals: services.renewals, clientOf, sign: (location) => notices.sign(location) }));
  // The newsletter (decision 0013, section 1): issues for staff, and signing up and leaving for anyone.
  const sendOne = email ? async (message: { to: string; subject: string; body: string; headers?: Readonly<Record<string, string>> }) => "ok" in (await email.send({ channel: "email", ...message })) : null;
  const newsletterFooter = { publicUrl, address: contact.address };
  // Reviews (decision 0013, section 6): asking by email, when email is set up.
  const askMail: AskMail | null = email
    ? async (to, link, clientName) =>
        "ok" in
        (await email.send({
          channel: "email",
          to: to.email,
          subject: "Would you write a few words about working with us?",
          body: `Hi ${to.name.split(/\s+/)[0] ?? ""},\n\nThank you for trusting Potomac Solutions with ${clientName || "your business"}'s work. Would you tell others how it went? It takes a minute: a few stars, a few words, and whether we may show it on our website.\n\n${link}\n\nThe link works once, for 30 days. If you'd rather not, ignore this email: no hard feelings.\n\nMikey and Jayanti\nPotomac Solutions`,
        }))
    : null;
  forms.route("/", demoRoutes({ demos: services.demos, actorOf, sign: (location) => notices.sign(location), publicUrl, mail: sendOne }));
  forms.route("/", referralCreditRoutes({ credit: services.referralCredit, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", showcaseStaffRoutes({ showcase: services.showcase, actorOf, sign: (location) => notices.sign(location), publicUrl, mail: askMail }));
  forms.route("/", reviewWritingRoutes({ showcase: services.showcase, sign: (location) => notices.sign(location), clientOf }));
  forms.route("/", automationRoutes({ automations: services.automations, actorOf, sign: (location) => notices.sign(location), publicUrl, secretPage: (view) => renderPage("Check-in address", automationSecretPage(view)) }));
  forms.route("/", reportRoutes({ reports: services.clientReports, actorOf, sign: (location) => notices.sign(location), mail: sendOne, contactLine: reportContactLine }));
  forms.route("/", newsletterRoutes({ newsletter: services.newsletter, actorOf, sign: (location) => notices.sign(location), footer: newsletterFooter, mail: sendOne }));
  forms.route(
    "/",
    riverRoutes({
      newsletter: services.newsletter,
      sign: (location) => notices.sign(location),
      mailConfirm: confirmNewsletter,
      publicUrl,
      returnOrigins: formOrigins,
      addressOf: (incoming) => clientAddressOf(incoming as IncomingMessage),
      allowPerAddress: sqliteRateLimit(db, { name: "newsletter-address", max: 5, windowMs: 60 * 60_000 }),
      allowPerEmail: newsletterPerEmail,
      log,
    }),
  );
  forms.route("/", todoRoutes({ todos: services.todos, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", shareRoutes({ projects: projectsDeps, sign: (location) => notices.sign(location), allowComment: sqliteRateLimit(db, { name: "share-comment", max: 30, windowMs: 60 * 60_000 }) }));
  forms.route("/", webhookRoutes({ webhooks: services.webhooks, actorOf, sign: (location) => notices.sign(location), secretPage: (view) => renderPage("Webhook secret", webhookSecretPage(view)) }));
  forms.route("/", noticeRoutes({ notices: services.notices, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", builderRoutes({ builder: services.builder, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", publicSiteRoutes({ website: services.publicSite, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", socialStaffRoutes({ social: services.social, actorOf, clientOf, sign: (location) => notices.sign(location) }));
  forms.route("/", socialPortalRoutes({ social: services.social, actorOf, clientOf, sign: (location) => notices.sign(location) }));
  forms.route("/", renewalRoutes({ renewals: services.renewals, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", inviteRoutes({ invites: services.invites, emails: bookingEmails, actorOf, bookerOf, sign: (location) => notices.sign(location) }));
  forms.route("/", sourceRoutes({ sources: services.sources, actorOf, bookerOf, sign: (location) => notices.sign(location) }));
  forms.route("/", bookingStaffRoutes({ booking: services.booking, crm: services.crm, calls: services.calls, emails: bookingEmails, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", settingsRoutes({ preferences: sessionDeps, actorOf, sign: (location) => notices.sign(location) }));
  forms.route(
    "/",
    forgotRoutes({
      request: requestReset,
      clientOf: (incoming) => clientAddressOf(incoming as IncomingMessage),
      allowPerAddress: sqliteRateLimit(db, { name: "forgot-address", max: 5, windowMs: 60 * 60_000 }),
      allowPerEmail: sqliteRateLimit(db, { name: "forgot-email", max: 3, windowMs: 60 * 60_000 }),
      sign: (location) => notices.sign(location),
    }),
  );
  forms.notFound((c) => c.html(renderPage("Not found", problemPage({ title: "Not found", message: "There is no page at this address." })), 404));
  forms.onError((error, c) => {
    log(`Form post failed: ${c.req.method} ${c.req.path}`, error);
    return c.html(renderPage("Something went wrong", problemPage({ title: "Something went wrong", message: "The error has been logged." })), 500);
  });
  const handleForms = getRequestListener(forms.fetch);

  function sameSite(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin || origin === "null") return false;
    try {
      // The inquiry form may also be posted from Potomac's own website.
      if (formOrigins.includes(new URL(origin).origin) && ["/contact", "/river"].includes(new URL(req.url ?? "/", "http://hq.invalid").pathname)) return true;
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  const allowSiteApi = sqliteRateLimit(db, { name: "site-api", max: 120, windowMs: 60_000 });
  const web = new Hono();
  const ping = db.prepare("select 1 as ok");
  web.route(
    "/",
    siteBookingRoutes({
      portal: portalDeps,
      booking: services.booking,
      emails: bookingEmails,
      isSite: (token) => settingsForSite(services.publicSite, token) !== null,
      open: signUpOpen,
      ownerFor: leadOwner,
      publicUrl,
      mail: async (to, link, kind, when) =>
        inviteMail !== null && "ok" in (await inviteMail.notify({ email: to.email }, kind === "booked" ? "website-booked" : "website-booking-again", { name: to.name, link, when })),
      allowPerVisitor: sqliteRateLimit(db, { name: "site-booking-visitor", max: 5, windowMs: 60 * 60_000 }),
      allowPerEmail: sqliteRateLimit(db, { name: "site-booking-email", max: 3, windowMs: 24 * 60 * 60_000 }),
      allowApi: (incoming) => allowSiteApi(clientAddressOf(incoming as never)),
      attribute: (organizationId, read) => void keepLeadTouch(services.leads, { organizationId }, touchFields(read)),
      credit: (code, organizationId) => {
        const opportunityId = services.leads.leads.newestOpenAt(organizationId);
        if (opportunityId && creditInquiry(services.referrals, code, opportunityId)) markReferredByLink(services.referralCredit, opportunityId);
      },
    }),
  );
  // n8n checking in (decision 0013, section 5): no cookie and no Origin, the token is the key.
  const allowCheckIn = sqliteRateLimit(db, { name: "automation-check-in", max: 120, windowMs: 60_000 });
  web.route("/", automationHookRoutes({ automations: services.automations, allow: (incoming) => allowCheckIn(clientAddressOf(incoming as never)) }));
  web.route("/", showcaseApiRoutes({ showcase: services.showcase, isSite: (token) => settingsForSite(services.publicSite, token) !== null, allow: (incoming) => allowSiteApi(clientAddressOf(incoming as never)) }));
  web.route("/", siteApiRoutes({ website: services.publicSite, allow: (incoming) => allowSiteApi(clientAddressOf(incoming as never)) }));
  web.route(
    "/",
    newsletterApiRoutes({
      newsletter: services.newsletter,
      mailConfirm: confirmNewsletter,
      publicUrl,
      isSite: (token) => settingsForSite(services.publicSite, token) !== null,
      allowApi: (incoming) => allowSiteApi(clientAddressOf(incoming as never)),
      allowPerVisitor: sqliteRateLimit(db, { name: "newsletter-visitor", max: 5, windowMs: 60 * 60_000 }),
      allowPerEmail: newsletterPerEmail,
      log,
    }),
  );
  web.route("/", staticRoutes({ assets: loadAssets(), healthy: () => ping.get()?.["ok"] === 1 }));
  const handleWeb = getRequestListener(web.fetch);
  // Downloads. Each one is authorized by the file service.
  const downloads = new Hono();
  downloads.route("/", fileRoutes({ files: projectsDeps, actorOf, clientOf: (cookieHeader) => clientSession(portalDeps, cookieHeader) }));
  downloads.route("/", publicBooking);
  downloads.route("/", bookingPortalDownloads({ booking: services.booking, bookerOf, sign: (location) => notices.sign(location) }));
  downloads.route("/", bookingStaffDownloads({ booking: services.booking, actorOf, sign: (location) => notices.sign(location), canSee: (actor) => actor !== null && authorize(sessionDeps, actor, "call.respond").ok }));
  downloads.route("/", twoFactorQrRoute({ twoFactor: twoFactorDeps, actorOf: setupActorOf }));
  downloads.route("/", twoFactorAppRoute({ twoFactor: twoFactorDeps, actorOf: setupActorOf }));
  downloads.route("/", auditDownloads({ audit: services.audit, actorOf, today }));
  downloads.route("/", websiteDownloads({ websites: services.websites, actorOf, clientOf }));
  downloads.route("/", builderDownloads({ builder: services.builder, actorOf }));
  downloads.route("/", referralDownloads({ referrals: services.referrals, actorOf, publicUrl }));
  downloads.route("/", demoLinkRoutes({ demos: services.demos }));
  downloads.route("/", showcaseDownloads({ showcase: services.showcase, actorOf }));
  downloads.route("/", freePageDownloads({ freePages: services.freePages, actorOf, clientOf, archive: config.siteArchive ?? null }));
  downloads.route("/", portalDownloads({ portal: portalDeps, clientOf: (cookieHeader) => clientSession(portalDeps, cookieHeader), renderProposalPdf: services.renderProposalPdf, renderInvoicePdf: services.renderInvoicePdf }));
  downloads.route("/", proposalDownloads({ proposals: proposalsDeps, actorOf, renderPdf: services.renderProposalPdf }));
  downloads.route("/", workDownloads({ projects: projectsDeps, actorOf }));
  downloads.route("/", shareFiles({ projects: projectsDeps }));
  downloads.route("/", calendarFeeds({ projects: projectsDeps, ...(config.publicUrl ? { publicUrl: config.publicUrl } : {}) }));
  downloads.route("/", noticeLinks({ notices: services.notices, actorOf }));
  downloads.route("/", financeDownloads({ finance: financeDeps, actorOf, renderInvoicePdf: services.renderInvoicePdf }));
  downloads.notFound((c) => c.text("Not found", 404));
  const handleDownloads = getRequestListener(downloads.fetch);
  const isStatic = (path: string) => path === "/api/site/settings" || path === "/api/site/booking" || path === "/api/site/newsletter" || path === "/api/site/showcase" || path.startsWith("/api/site/showcase/files/") || path === "/river/one-click" || path.startsWith("/hooks/automations/") || path === "/healthz" || path === "/favicon.ico" || path.startsWith("/assets/");

  function badRequest(res: ServerResponse): void {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("Bad request");
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    if (config.secure) res.setHeader("strict-transport-security", "max-age=31536000");
    // Every address HQ serves starts with one slash. Anything else ("//...",
    // a whole URL, or one that can't be read, which scanners send looking for
    // files like .env) is refused here, before any router sees it.
    const target = req.url ?? "/";
    if (!target.startsWith("/") || target.startsWith("//") || !URL.canParse(target, "http://hq.invalid")) return void badRequest(res);
    const url = new URL(target, "http://hq.invalid");
    const path = url.pathname;

    if (path === "/staff" || path.startsWith("/staff/")) return handleStaff(req, res, url);
    if (isStatic(path)) return void (await handleWeb(req, res));
    if (zubra.handle(req, res)) return; // the components' browser modules and stylesheets

    if (req.method !== "GET" && req.method !== "HEAD") {
      const type = String(req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
      // Browsers always send a length for a form. A post without one is refused,
      // so the size limit cannot be walked around with a streamed body.
      const length = req.headers["content-length"] === undefined ? Number.NaN : Number(req.headers["content-length"]);
      if (!sameSite(req)) return void sendHtml(res, 403, "Refused", problemPage({ title: "Refused", message: "That form did not come from Potomac HQ." }));
      const photo = type === "multipart/form-data" && PHOTO_PATHS.test(path);
      const upload = photo || (type === "multipart/form-data" && UPLOAD_PATHS.test(path));
      if (type !== "application/x-www-form-urlencoded" && !upload) return void sendHtml(res, 415, "Not a form", problemPage({ title: "Not a form", message: "This address only accepts form posts." }));
      const limit = photo ? MAX_PHOTO_FORM_BYTES : upload ? MAX_UPLOAD_BYTES : LONG_FORM_PATHS.test(path) ? MAX_LONG_FORM_BYTES : MAX_FORM_BYTES;
      if (!(length >= 0 && length <= limit)) return void sendHtml(res, 413, "Too much data", problemPage({ title: "Too much data", message: "That form was too large." }));
      return void (await handleForms(req, res));
    }

    // Pages show who is signed in, so they are never stored by a browser or proxy.
    res.setHeader("cache-control", "no-store");
    if (path.startsWith("/files/") || path.startsWith("/portal/files/") || path.startsWith("/exports/") || path === "/activity.csv" || path === "/work.csv" || path === "/portal/landing-page.zip" || /^\/case-study-shots\/[0-9a-f-]{36}$/.test(path) || /^\/clients\/[0-9a-f-]{36}\/landing-page\.zip$/.test(path) || /^\/s\/[A-Za-z0-9_-]{43}\/files\/[0-9a-f-]{36}$/.test(path) || /^\/calendar\/[A-Za-z0-9_-]{43}\.ics$/.test(path) || /^\/notices\/[0-9a-f-]{36}$/.test(path) || path === "/settings/two-factor/qr.svg" || path === "/settings/two-factor/app" || path.startsWith("/r/") || path.startsWith("/d/") || path.startsWith("/websites/photos/") || path.startsWith("/builder/preview/") || /^\/builder\/[0-9a-f-]{36}\/(versions\/\d{1,6}\/site\.zip|images\/[0-9a-f-]{36})$/.test(path) || path.startsWith("/portal/website/photos/") || /^\/referrals\/[^/]+\/qr\.svg$/.test(path) || /^\/(portal\/)?calls\/[^/]+\.ics$/.test(path) || path === "/book/manage/call.ics" || /^\/(portal\/)?(invoices|proposals)\/[^/]+\/pdf$/.test(path) || /^\/proposals\/[^/]+\/versions\/[^/]+\/pdf$/.test(path)) return void (await handleDownloads(req, res));
    if (await router.handle(req, res)) return;
    await router.notFound(req, res);
  }

  return {
    listener(req, res) {
      handle(req, res).catch((error: unknown) => {
        log(`Unhandled error: ${req.method} ${req.url}`, error);
        if (!res.headersSent) {
          sendHtml(res, 500, "Something went wrong", problemPage({ title: "Something went wrong", message: "The error has been logged." }));
        } else {
          res.end();
        }
      });
    },
    async setupPath() {
      const token = await staff.setup();
      return token ? `/staff/accept?token=${token}` : null;
    },
    async resetPath(email) {
      const wanted = email.trim().toLowerCase();
      const people = staff.list();
      const target = people.find((one) => one.email === wanted && !one.disabled);
      const owner = people.find((one) => one.roles.includes("owner") && !one.disabled);
      if (!target || !owner) return null;
      const made = await staff.resetLink({ account: owner.account }, target.account);
      if (!made.ok) return null;
      const user = users.findByStaffAccount(target.account);
      // Run from the server by someone with access to it, so there is no
      // signed-in actor. The event still says it happened.
      if (user) {
        sessionDeps.transact(() => {
          recordActivity(sessionDeps, {
            actorId: null,
            action: "user.reset-link-issued",
            recordType: "user",
            recordId: user.id,
            context: { by: "server-command" },
          });
        });
      }
      return `/staff/accept?token=${made.token}`;
    },
  };
}
