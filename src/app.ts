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
import { clientDetail, followUpsDue, listClients, opportunityDetail, pipeline, pipelineReport } from "./crm/index.ts";
import { auditDownloads } from "./dashboard/api/audit-routes.ts";
import { auditHistory, recentActivity } from "./dashboard/index.ts";
import { fileRoutes } from "./files/api/file-routes.ts";
import { financeDownloads, financeRoutes } from "./finance/api/finance-routes.ts";
import { financeOverview, hoursThisWeek, invoiceDetail, projectMoney, projectsOverBudget, taskTime, timeSheet } from "./finance/index.ts";
import { MAX_FILE_BYTES } from "./files/index.ts";
import { createHqStaffPages, memoryRateLimit } from "./identity/adapters.ts";
import { peopleRoutes } from "./identity/api/people-routes.ts";
import { forgotRoutes } from "./identity/api/forgot-routes.ts";
import { settingsRoutes } from "./identity/api/settings-routes.ts";
import { staffRoutes } from "./identity/api/staff-routes.ts";
import { authorize, establishUser, listPeople, requestPasswordReset, THEME_LABELS, type SignedInAccount, type Theme } from "./identity/index.ts";
import { problemPage, userLinkPage } from "./identity/ui/views.ts";
import { knowledgeRoutes } from "./knowledge/api/knowledge-routes.ts";
import { articleDetail, articleRevision, listArticles } from "./knowledge/index.ts";
import { noteRoutes } from "./notes/api/note-routes.ts";
import { clientPortalRoutes, portalDownloads, staffPortalRoutes } from "./portal/api/portal-routes.ts";
import { callsWaiting, clientActivity, clientFiles, clientSession, portalAccess, portalHome, portalProject, portalProposal, projectUpdates } from "./portal/index.ts";
import { linkPage } from "./portal/ui/views.ts";
import { listNotes } from "./notes/index.ts";
import { projectRoutes } from "./projects/api/project-routes.ts";
import { proposalDownloads, proposalRoutes } from "./proposals/api/proposal-routes.ts";
import { listProposals, proposalDetail, proposalsFor, proposalVersion } from "./proposals/index.ts";
import { activeProjects, board, listProjects, projectHealthReport, projectOverview, projectTasks, taskDetail, upcomingDeadlines } from "./projects/index.ts";
import { createServices } from "./services.ts";
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
  /** Outbound email. Without it, "Forgot your password?" says to ask an administrator. */
  readonly email?: EmailConfig | null;
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
// UI components use them.
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
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
  /** The sign-in or no-access page when there is no active HQ user, otherwise null. Every page calls it first. */
  guard(): Answer | null;
  /** The no-access page, for a read that was refused. */
  forbidden(): Answer;
  readonly dashboard: { recentActivity(): ReturnType<typeof recentActivity>; audit(query: Record<string, string>): ReturnType<typeof auditHistory> };
  readonly crm: {
    listClients(status?: string): ReturnType<typeof listClients>;
    pipeline(): ReturnType<typeof pipeline>;
    clientDetail(id: string): ReturnType<typeof clientDetail>;
    opportunityDetail(id: string): ReturnType<typeof opportunityDetail>;
    followUpsDue(): ReturnType<typeof followUpsDue>;
  };
  readonly projects: {
    list(status?: string): ReturnType<typeof listProjects>;
    overview(id: string): ReturnType<typeof projectOverview>;
    tasks(id: string): ReturnType<typeof projectTasks>;
    /** One project's board, or every active project's when `projectId` is "". */
    board(projectId: string, mine: boolean): ReturnType<typeof board>;
    task(id: string): ReturnType<typeof taskDetail>;
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
    overview(): ReturnType<typeof financeOverview>;
    project(id: string): ReturnType<typeof projectMoney>;
    overBudget(): ReturnType<typeof projectsOverBudget>;
    invoice(id: string): ReturnType<typeof invoiceDetail>;
  };
  /** What the viewer may open, so the shell and tabs offer only that. The pages themselves still check. */
  readonly can: { readonly proposals: boolean; readonly money: boolean; readonly time: boolean; readonly audit: boolean; readonly reports: boolean };
  /** What HQ's own users see about the portal. */
  readonly portalAdmin: {
    access(organizationId: string): ReturnType<typeof portalAccess>;
    updates(projectId: string): ReturnType<typeof projectUpdates>;
    files(projectId: string): ReturnType<typeof clientFiles>;
    fromClients(): ReturnType<typeof clientActivity>;
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
    /** What a one-time link is for, without using it. */
    link(token: string): { readonly valid: boolean; readonly token: string; readonly email: string; readonly name: string; readonly invite: boolean };
  };
  readonly reports: {
    pipeline(days: string): ReturnType<typeof pipelineReport>;
    projects(): ReturnType<typeof projectHealthReport>;
    budget(): ReturnType<typeof financeOverview>;
  };
  readonly people: { list(): ReturnType<typeof listPeople> };
  readonly knowledge: {
    list(query: Record<string, string>): ReturnType<typeof listArticles>;
    article(slug: string): ReturnType<typeof articleDetail>;
    revision(slug: string, number: string): ReturnType<typeof articleRevision>;
  };
  readonly settings: { readonly theme: Theme; readonly themes: readonly { value: string; label: string }[] };
};

/** An id from an address. Anything that is not one is simply not found. */
function withId<T>(text: string, read: (id: Id) => Result<T, "forbidden" | "not-found">): Result<T, "forbidden" | "not-found"> {
  const id = parseId(text);
  return id.ok ? read(id.value) : err("not-found");
}

const MAX_FORM_BYTES = 16 * 1024;
// Forms that carry a file. Only these addresses accept one, and each has its
// own size limit: the file, plus room for the form's other fields.
const UPLOAD_PATHS = /^\/(projects\/[0-9a-f-]{36}\/(deliverables|expenses)|proposals\/[0-9a-f-]{36}\/agreement|portal\/projects\/[0-9a-f-]{36}\/files)$/;
// Forms with long text in them: a proposal's sections, and an article.
const LONG_FORM_PATHS = /^\/(proposals\/[0-9a-f-]{36}|knowledge|articles\/[0-9a-f-]{36})$/;
const MAX_LONG_FORM_BYTES = 128 * 1024;
const MAX_UPLOAD_BYTES = MAX_FILE_BYTES + 64 * 1024;

export async function createApp(config: AppConfig): Promise<App> {
  const log = config.log ?? ((message, error) => console.error(message, error ?? ""));
  const { db } = config;

  const services = createServices(db, { secure: config.secure, ...(config.passwordCost ? { passwordCost: config.passwordCost } : {}) });
  const { session: sessionDeps, crm: crmDeps, dashboard: dashboardDeps, projects: projectsDeps, notes: notesDeps, proposals: proposalsDeps, finance: financeDeps, portal: portalDeps, today } = services;
  const users = sessionDeps.users;
  const contact: PortalContact = config.contact ?? { phone: "", email: "", address: "" };
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

  const handleStaff = staffRoutes({
    handle: (req, res, url, form) => pages.handle(req, res, url, form),
    session: account,
    clientOf: clientAddressOf,
    allowAttempt: memoryRateLimit({ max: config.attemptsPerMinute ?? 10, windowMs: 60_000 }),
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
      const actor = user?.id ?? null;
      const signIn = { ...notice, needsOwner: staff.needsOwner(), emailEnabled: Boolean(config.email) };
      const forbidden = () => show("identity/ui/no-access", { title: "No access" }, { status: 403 });
      const date = today();
      const client = clientSession(portalDeps, request.headers.get("cookie") ?? "");
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
          link: (token) => {
            const found = /^[A-Za-z0-9_-]{43}$/.test(token) ? portalDeps.auth.peek(token) : null;
            const user = found ? portalDeps.clientUsers.byEmail(found.email) : null;
            return found && user && user.status !== "disabled" ? { valid: true, token, email: found.email, name: user.name, invite: found.kind === "invite" } : { valid: false, token: "", email: "", name: "", invite: false };
          },
        },
        signedIn: who !== null,
        user: user ? { id: user.id, name: user.name } : null,
        notice,
        signIn,
        today: date,
        guard: () => (who === null ? show("identity/ui/sign-in-page", { ...signIn, title: "Sign in" }, { status: 401 }) : user === null ? forbidden() : null),
        forbidden,
        dashboard: { recentActivity: () => recentActivity(dashboardDeps, actor), audit: (query) => auditHistory(services.audit, actor, query) },
        crm: {
          listClients: (status) => listClients(crmDeps, actor, { status: status ?? "" }),
          pipeline: () => pipeline(crmDeps, actor, date),
          clientDetail: (id) => withId(id, (clientId) => clientDetail(crmDeps, actor, clientId)),
          opportunityDetail: (id) => withId(id, (opportunityId) => opportunityDetail(crmDeps, actor, opportunityId, date)),
          followUpsDue: () => followUpsDue(crmDeps, actor, date),
        },
        projects: {
          list: (status) => listProjects(projectsDeps, actor, { status: status ?? "" }),
          overview: (id) => withId(id, (projectId) => projectOverview(projectsDeps, actor, projectId)),
          tasks: (id) => withId(id, (projectId) => projectTasks(projectsDeps, actor, projectId)),
          board: (id, mine) => (id === "" ? board(projectsDeps, actor, { mine }) : withId(id, (projectId) => board(projectsDeps, actor, { projectId, mine }))),
          task: (id) => withId(id, (taskId) => taskDetail(projectsDeps, actor, taskId)),
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
          overview: () => financeOverview(financeDeps, actor),
          project: (id) => withId(id, (projectId) => projectMoney(financeDeps, actor, projectId)),
          overBudget: () => projectsOverBudget(financeDeps, actor),
          invoice: (id) => withId(id, (invoiceId) => invoiceDetail(financeDeps, actor, invoiceId)),
        },
        can: { proposals: authorize(sessionDeps, actor, "proposal.view").ok, money: authorize(sessionDeps, actor, "finance.view").ok, time: authorize(sessionDeps, actor, "time.log").ok, audit: authorize(sessionDeps, actor, "activity.view-all").ok, reports: authorize(sessionDeps, actor, "report.view").ok },
        reports: {
          pipeline: (days) => pipelineReport(crmDeps, actor, date, /^\d{1,3}$/.test(days) ? Number(days) : 90),
          projects: () => projectHealthReport(projectsDeps, actor),
          budget: () => (authorize(sessionDeps, actor, "report.view").ok ? financeOverview(financeDeps, actor) : err("forbidden")),
        },
        people: { list: () => listPeople(sessionDeps, actor) },
        knowledge: {
          list: (query) => listArticles(services.knowledge, actor, query),
          article: (slug) => articleDetail(services.knowledge, actor, slug),
          revision: (slug, number) => articleRevision(services.knowledge, actor, slug, /^\d{1,6}$/.test(number) ? Number(number) : Number.NaN),
        },
        settings: { theme: user ? users.themeOf(user.id) : "system", themes },
      };
    },
  });

  // Form posts. A page's own forms only: the browser must say the post came
  // from this site (Origin), it must be a form, and it must be small.
  const actorOf = (cookieHeader: string): Id | null => {
    const who = account(cookieHeader);
    const user = who ? establishUser(sessionDeps, who) : null;
    return user?.id ?? null;
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

  const forms = new Hono();
  forms.route("/", crmRoutes({ crm: crmDeps, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", projectRoutes({ projects: projectsDeps, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", proposalRoutes({ proposals: proposalsDeps, actorOf, sign: (location) => notices.sign(location) }));
  forms.route("/", financeRoutes({ finance: financeDeps, actorOf, sign: (location) => notices.sign(location) }));
  const clientOf = (cookieHeader: string) => clientSession(portalDeps, cookieHeader);
  const publicUrl = (config.publicUrl ?? "").replace(/\/$/, "");
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
      allowAttempt: memoryRateLimit({ max: config.attemptsPerMinute ?? 10, windowMs: 60_000 }),
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
  forms.route("/", settingsRoutes({ preferences: sessionDeps, actorOf, sign: (location) => notices.sign(location) }));
  forms.route(
    "/",
    forgotRoutes({
      request: requestReset,
      clientOf: (incoming) => clientAddressOf(incoming as IncomingMessage),
      allowPerAddress: memoryRateLimit({ max: 5, windowMs: 60 * 60_000 }),
      allowPerEmail: memoryRateLimit({ max: 3, windowMs: 60 * 60_000 }),
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
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  const web = new Hono();
  const ping = db.prepare("select 1 as ok");
  web.route("/", staticRoutes({ assets: loadAssets(), healthy: () => ping.get()?.["ok"] === 1 }));
  const handleWeb = getRequestListener(web.fetch);
  // Downloads. Each one is authorized by the file service.
  const downloads = new Hono();
  downloads.route("/", fileRoutes({ files: projectsDeps, actorOf, clientOf: (cookieHeader) => clientSession(portalDeps, cookieHeader) }));
  downloads.route("/", auditDownloads({ audit: services.audit, actorOf, today }));
  downloads.route("/", portalDownloads({ portal: portalDeps, clientOf: (cookieHeader) => clientSession(portalDeps, cookieHeader), renderProposalPdf: services.renderProposalPdf, renderInvoicePdf: services.renderInvoicePdf }));
  downloads.route("/", proposalDownloads({ proposals: proposalsDeps, actorOf, renderPdf: services.renderProposalPdf }));
  downloads.route("/", financeDownloads({ finance: financeDeps, actorOf, renderInvoicePdf: services.renderInvoicePdf }));
  downloads.notFound((c) => c.text("Not found", 404));
  const handleDownloads = getRequestListener(downloads.fetch);
  const isStatic = (path: string) => path === "/healthz" || path === "/favicon.ico" || path.startsWith("/assets/");

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    if (config.secure) res.setHeader("strict-transport-security", "max-age=31536000");
    const url = new URL(req.url ?? "/", "http://hq.invalid");
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
      const upload = type === "multipart/form-data" && UPLOAD_PATHS.test(path);
      if (type !== "application/x-www-form-urlencoded" && !upload) return void sendHtml(res, 415, "Not a form", problemPage({ title: "Not a form", message: "This address only accepts form posts." }));
      const limit = upload ? MAX_UPLOAD_BYTES : LONG_FORM_PATHS.test(path) ? MAX_LONG_FORM_BYTES : MAX_FORM_BYTES;
      if (!(length >= 0 && length <= limit)) return void sendHtml(res, 413, "Too much data", problemPage({ title: "Too much data", message: "That form was too large." }));
      return void (await handleForms(req, res));
    }

    // Pages show who is signed in, so they are never stored by a browser or proxy.
    res.setHeader("cache-control", "no-store");
    if (path.startsWith("/files/") || path.startsWith("/portal/files/") || path.startsWith("/exports/") || path === "/activity.csv" || /^\/(portal\/)?(invoices|proposals)\/[^/]+\/pdf$/.test(path) || /^\/proposals\/[^/]+\/versions\/[^/]+\/pdf$/.test(path)) return void (await handleDownloads(req, res));
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
