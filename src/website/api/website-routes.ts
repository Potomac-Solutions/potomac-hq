// The website page's forms, and the one address the website itself calls.
import { Hono } from "hono";
import { renewPreviewLink, saveSiteSettings, settingsForSite, type WebsiteDeps } from "../application/website.ts";
import { formPosts, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "invalid-mode": "Choose open, coming soon or maintenance.",
  "title-too-long": "Keep the heading under 80 characters.",
  "message-too-long": "Keep the message under 400 characters.",
  "eta-too-long": "Keep the time note under 80 characters.",
  "banner-too-long": "Keep the announcement under 200 characters.",
  "link-text-too-long": "Keep the link’s words under 40 characters.",
  "link-text-missing": "Say what the announcement’s link should read.",
  "invalid-link": "A link starts with https:// or with a single /.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

export function websiteRoutes(deps: { readonly website: WebsiteDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/website" });
  post(
    "/website",
    (actor, f) => saveSiteSettings(deps.website, actor, { mode: f["mode"] ?? "", title: f["title"] ?? "", message: f["message"] ?? "", eta: f["eta"] ?? "", bannerText: f["bannerText"] ?? "", bannerLinkText: f["bannerLinkText"] ?? "", bannerHref: f["bannerHref"] ?? "" }),
    { done: () => "/website", back: () => "/website", message: "Saved. The website follows within a minute." },
  );
  post("/website/preview", (actor) => renewPreviewLink(deps.website, actor), { done: () => "/website", back: () => "/website", message: "New preview link made. The old one no longer works." });
  return app;
}

/**
 * GET /api/site/settings, called by the website with its token. Anything else,
 * or a wrong token, is a plain 401 that says nothing about why.
 */
export function siteApiRoutes(deps: { readonly website: WebsiteDeps; readonly allow: (incoming: Request) => boolean }): Hono {
  const app = new Hono();
  app.get("/api/site/settings", (c) => {
    if (!deps.allow(c.req.raw)) return c.json({ ok: false }, 429, { "cache-control": "no-store" });
    const header = c.req.header("authorization") ?? "";
    const token = /^Bearer (\S+)$/.exec(header)?.[1] ?? null;
    const found = settingsForSite(deps.website, token);
    return found ? c.json(found, 200, { "cache-control": "no-store" }) : c.json({ ok: false }, 401, { "cache-control": "no-store" });
  });
  return app;
}
