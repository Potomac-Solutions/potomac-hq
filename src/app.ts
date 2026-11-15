// The composition root: the one place that knows every layer. It builds the
// adapters, hands them to the application services and routes, and returns a
// Node request listener.
import { getRequestListener } from "@hono/node-server";
import { createRouter } from "@zubra/router";
import { createZubra } from "@zubra/server";
import { Hono } from "hono";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { formatWhenIn, sqliteActivityReader } from "./dashboard/adapters.ts";
import { recentActivity, type RecentActivityDeps } from "./dashboard/index.ts";
import { createHqStaff, createHqStaffPages, memoryRateLimit, sqliteUserStore } from "./identity/adapters.ts";
import { staffRoutes } from "./identity/api/staff-routes.ts";
import { establishUser, type SessionDeps, type SignedInAccount } from "./identity/index.ts";
import { problemPage } from "./identity/ui/views.ts";
import { newId, sqliteActivityLog, sqliteTransact, systemClock, type Database } from "./shared/adapters.ts";
import { staticRoutes } from "./shared/api/static-routes.ts";
import { recordActivity } from "./shared/index.ts";
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

/** What every page's `load` is given as `context`. UI files get the app's services only through this. */
export type PageContext = {
  /** True when a session is live, whether or not it maps to an HQ user. */
  readonly signedIn: boolean;
  /** The active HQ user, or null. */
  readonly user: { readonly id: string; readonly name: string } | null;
  /** A message from the last redirect, shown once. Only ever one the server signed. */
  readonly notice: { readonly problem: string; readonly done: string };
  /** Props for the sign-in page. */
  readonly signIn: { readonly problem: string; readonly done: string; readonly needsOwner: boolean };
  readonly dashboard: { recentActivity(): ReturnType<typeof recentActivity> };
};

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
  const { pages, clientOf, readNotice } = createHqStaffPages({
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
    lang: "en",
    head: `<meta name="robots" content="noindex, nofollow">${HEAD_LINKS}`,
    onError: (error, request) => log(`Page failed: ${request.method} ${new URL(request.url).pathname}`, error),
    context: ({ request }): PageContext => {
      const who = account(request.headers.get("cookie") ?? "");
      const user = who ? establishUser(sessionDeps, who) : null;
      const notice = readNotice(new URL(request.url));
      return {
        signedIn: who !== null,
        user: user ? { id: user.id, name: user.name } : null,
        notice,
        signIn: { ...notice, needsOwner: staff.needsOwner() },
        dashboard: { recentActivity: () => recentActivity(dashboardDeps, user?.id ?? null) },
      };
    },
  });

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
