import { Hono } from "hono";
import { establishUser, type SessionDeps, type SignedInAccount } from "../application/session.ts";

export type HomeRoutesDeps = {
  /** Who a Cookie header is signed in as, with the kit's account bar for them. */
  readonly session: (cookieHeader: string) => { who: SignedInAccount; barHtml: string } | null;
  readonly sessionDeps: SessionDeps;
  readonly readNotice: (url: URL) => { problem: string; done: string };
  readonly views: {
    page(title: string, bodyHtml: string): string;
    signIn(url: URL): string;
    signedInHome(view: { name: string; barHtml: string; notice: { problem: string; done: string } }): string;
    noHqUser(view: { barHtml: string }): string;
  };
};

export function homeRoutes(deps: HomeRoutesDeps): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  // No icon yet. Answering keeps browsers from logging a failed request.
  app.get("/favicon.ico", (c) => c.body(null, 204));

  app.get("/", (c) => {
    const url = new URL(c.req.url);
    c.header("cache-control", "no-store");
    const session = deps.session(c.req.header("cookie") ?? "");
    if (!session) return c.html(deps.views.page("Sign in", deps.views.signIn(url)));

    const user = establishUser(deps.sessionDeps, session.who);
    if (!user) return c.html(deps.views.page("No access", deps.views.noHqUser({ barHtml: session.barHtml })), 403);

    const body = deps.views.signedInHome({ name: user.name, barHtml: session.barHtml, notice: deps.readNotice(url) });
    return c.html(deps.views.page("Home", body));
  });

  return app;
}
