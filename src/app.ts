// The composition root: the one place that knows every layer. It builds the
// adapters, hands them to the application services and routes, and returns a
// Node request listener.
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHqStaff, createHqStaffPages, memoryRateLimit, sqliteUserStore } from "./identity/adapters.ts";
import { homeRoutes } from "./identity/api/home-routes.ts";
import { staffRoutes } from "./identity/api/staff-routes.ts";
import type { SessionDeps, SignedInAccount } from "./identity/index.ts";
import { noHqUser, problemPage, signedInHome } from "./identity/ui/views.ts";
import { newId, sqliteActivityLog, sqliteTransact, systemClock, type Database } from "./shared/adapters.ts";
import { recordActivity } from "./shared/index.ts";
import { renderPage } from "./shared/ui/page.ts";

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

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

export function createApp(config: AppConfig): App {
  const log = config.log ?? ((message, error) => console.error(message, error ?? ""));
  const { db } = config;

  const sessionDeps: SessionDeps = {
    users: sqliteUserStore(db),
    activityLog: sqliteActivityLog(db),
    transact: sqliteTransact(db),
    clock: systemClock,
    newId,
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

  const web = new Hono();
  web.route(
    "/",
    homeRoutes({
      session: (cookieHeader) => {
        const who = staff.session(cookieHeader);
        const signedIn = account(cookieHeader);
        return who && signedIn ? { who: signedIn, barHtml: pages.bar(who) } : null;
      },
      sessionDeps,
      readNotice,
      views: { page: renderPage, signIn: (url) => pages.signIn(url), signedInHome, noHqUser },
    }),
  );
  web.notFound((c) => c.html(renderPage("Not found", problemPage({ title: "Not found", message: "There is no page at this address." })), 404));
  web.onError((error, c) => {
    log("Unhandled error", error);
    return c.html(renderPage("Something went wrong", problemPage({ title: "Something went wrong", message: "The error has been logged." })), 500);
  });
  const handleWeb = getRequestListener(web.fetch);

  return {
    listener(req, res) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
      if (config.secure) res.setHeader("strict-transport-security", "max-age=31536000");
      const url = new URL(req.url ?? "/", "http://hq.invalid");
      if (url.pathname === "/staff" || url.pathname.startsWith("/staff/")) {
        handleStaff(req, res, url).catch((error: unknown) => {
          log("Unhandled error in a sign-in route", error);
          if (!res.headersSent) {
            sendHtml(res, 500, "Something went wrong", problemPage({ title: "Something went wrong", message: "The error has been logged." }));
          } else {
            res.end();
          }
        });
        return;
      }
      void handleWeb(req, res);
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
      const user = sessionDeps.users.findByStaffAccount(target.account);
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
