// The composition root: the one place that knows every layer. It builds the
// adapters, hands them to the application services and routes, and returns a
// Node request listener.
import { getRequestListener } from "@hono/node-server";
import { createRouter, show } from "@zubra/router";
import { createZubra } from "@zubra/server";
import { Hono } from "hono";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { sqliteClientStore, sqliteContactStore, sqliteOpportunityStore } from "./crm/adapters.ts";
import { crmRoutes } from "./crm/api/crm-routes.ts";
import { clientDetail, followUpsDue, listClients, opportunityDetail, pipeline, type CrmDeps } from "./crm/index.ts";
import { formatWhenIn, sqliteActivityReader } from "./dashboard/adapters.ts";
import { recentActivity, type RecentActivityDeps } from "./dashboard/index.ts";
import { createHqStaff, createHqStaffPages, memoryRateLimit, sqliteUserStore } from "./identity/adapters.ts";
import { forgotRoutes } from "./identity/api/forgot-routes.ts";
import { staffRoutes } from "./identity/api/staff-routes.ts";
import { establishUser, requestPasswordReset, type SessionDeps, type SignedInAccount } from "./identity/index.ts";
import { problemPage } from "./identity/ui/views.ts";
import { createNotify } from "@potomac-solutions/kit/notify";
import { newId, sqliteActivityLog, sqliteTransact, systemClock, type Database, type EmailConfig } from "./shared/adapters.ts";
import { staticRoutes } from "./shared/api/static-routes.ts";
import { sqliteProjectStore } from "./projects/adapters.ts";
import { projectDetail } from "./projects/index.ts";
import { err, parseId, recordActivity, type Id, type Result } from "./shared/index.ts";
import { loadAssets } from "./shared/ui/assets.ts";
import { HEAD_LINKS, renderPage } from "./shared/ui/page.ts";

/** "Due today" and the times people read are worked out here (docs/data-model.md). */
export const BUSINESS_TIME_ZONE = "America/New_York";

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
  /** Outbound email. Without it, "Forgot your password?" says to ask an administrator. */
  readonly email?: EmailConfig | null;
};

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
  readonly dashboard: { recentActivity(): ReturnType<typeof recentActivity> };
  readonly crm: {
    listClients(status?: string): ReturnType<typeof listClients>;
    pipeline(): ReturnType<typeof pipeline>;
    clientDetail(id: string): ReturnType<typeof clientDetail>;
    opportunityDetail(id: string): ReturnType<typeof opportunityDetail>;
    followUpsDue(): ReturnType<typeof followUpsDue>;
  };
  readonly projects: { projectDetail(id: string): ReturnType<typeof projectDetail> };
};

/** An id from an address. Anything that is not one is simply not found. */
function withId<T>(text: string, read: (id: Id) => Result<T, "forbidden" | "not-found">): Result<T, "forbidden" | "not-found"> {
  const id = parseId(text);
  return id.ok ? read(id.value) : err("not-found");
}

const MAX_FORM_BYTES = 16 * 1024;

export async function createApp(config: AppConfig): Promise<App> {
  const log = config.log ?? ((message, error) => console.error(message, error ?? ""));
  const { db } = config;

  const users = sqliteUserStore(db);
  const sessionDeps: SessionDeps = {
    users,
    activityLog: sqliteActivityLog(db),
    transact: sqliteTransact(db),
    clock: systemClock,
    newId,
  };
  const crmDeps: CrmDeps = {
    ...sessionDeps,
    clients: sqliteClientStore(db),
    contacts: sqliteContactStore(db),
    opportunities: sqliteOpportunityStore(db),
    projects: sqliteProjectStore(db),
  };
  const today = () => Temporal.Now.plainDateISO(BUSINESS_TIME_ZONE).toString();
  const dashboardDeps: RecentActivityDeps = {
    users,
    activity: sqliteActivityReader(db),
    formatWhen: formatWhenIn(BUSINESS_TIME_ZONE),
  };

  const staff = createHqStaff(db, { secure: config.secure });
  const sendHtml = (res: ServerResponse, status: number, title: string, body: string) => {
    const html = renderPage(title, body);
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html) });
    res.end(html);
  };
  const { pages, clientOf, readNotice, notices } = createHqStaffPages({
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
    clientOf,
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
    head: `<meta name="robots" content="noindex, nofollow">${HEAD_LINKS}`,
    onError: (error, request) => log(`Page failed: ${request.method} ${new URL(request.url).pathname}`, error),
    context: ({ request }): PageContext => {
      const who = account(request.headers.get("cookie") ?? "");
      const user = who ? establishUser(sessionDeps, who) : null;
      const notice = readNotice(new URL(request.url));
      const actor = user?.id ?? null;
      const signIn = { ...notice, needsOwner: staff.needsOwner(), emailEnabled: Boolean(config.email) };
      const forbidden = () => show("identity/ui/no-access", { title: "No access" }, { status: 403 });
      const date = today();
      return {
        signedIn: who !== null,
        user: user ? { id: user.id, name: user.name } : null,
        notice,
        signIn,
        today: date,
        guard: () => (who === null ? show("identity/ui/sign-in-page", { ...signIn, title: "Sign in" }, { status: 401 }) : user === null ? forbidden() : null),
        forbidden,
        dashboard: { recentActivity: () => recentActivity(dashboardDeps, actor) },
        crm: {
          listClients: (status) => listClients(crmDeps, actor, { status: status ?? "" }),
          pipeline: () => pipeline(crmDeps, actor, date),
          clientDetail: (id) => withId(id, (clientId) => clientDetail(crmDeps, actor, clientId)),
          opportunityDetail: (id) => withId(id, (opportunityId) => opportunityDetail(crmDeps, actor, opportunityId, date)),
          followUpsDue: () => followUpsDue(crmDeps, actor, date),
        },
        projects: { projectDetail: (id) => withId(id, (projectId) => projectDetail(crmDeps, actor, projectId)) },
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
  forms.route(
    "/",
    forgotRoutes({
      request: requestReset,
      clientOf: (incoming) => clientOf(incoming as IncomingMessage),
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
  web.route("/", staticRoutes({ assets: loadAssets() }));
  const handleWeb = getRequestListener(web.fetch);
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
      if (type !== "application/x-www-form-urlencoded") return void sendHtml(res, 415, "Not a form", problemPage({ title: "Not a form", message: "This address only accepts form posts." }));
      if (!(length >= 0 && length <= MAX_FORM_BYTES)) return void sendHtml(res, 413, "Too much data", problemPage({ title: "Too much data", message: "That form was too large." }));
      return void (await handleForms(req, res));
    }

    // Pages show who is signed in, so they are never stored by a browser or proxy.
    res.setHeader("cache-control", "no-store");
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
