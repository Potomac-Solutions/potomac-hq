// The site builder's forms, its .zip downloads and its preview frame
// (decision 0010).
import { Hono } from "hono";
import * as builder from "../application/builder.ts";
import type { BuilderDeps } from "../application/builder.ts";
import { formPosts, parseId, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "no-such-client": "Choose a client for the site.",
  "name-missing": "Give the build a name, like Better Days Towing website.",
  "name-too-long": "Keep the name under 80 characters.",
  "brief-too-long": "Keep the brief under 4,000 characters.",
  "ask-missing": "Say what Claude should do.",
  "ask-too-long": "Keep a request under 2,000 characters. Ask for one thing at a time.",
  "claude-not-set-up": "HQ has no Claude API key, so it can’t ask Claude. Set HQ_ANTHROPIC_API_KEY on the server.",
  "busy-build": "Claude is still working on this site. Wait for that answer first.",
  "over-cap": "That could pass this month’s cap, so it wasn’t sent. Ask for something smaller, or the owner can raise the cap.",
  "already-newest": "That is already the newest version.",
  "model-unknown": "Choose one of the models listed.",
  "cap-invalid": "Enter the cap in dollars, from $1 to $1,000, like 10 or 12.50.",
  "image-missing": "Choose a picture first.",
  "image-too-large": "That picture is too big for a web page. Try again in a current browser, which shrinks it for you, or send a smaller copy.",
  "image-not-a-picture": "That file isn’t a JPEG, PNG or WebP picture HQ can read.",
  "kind-invalid": "Say whether it’s a photo or the logo.",
  "alt-missing": "Say what the picture shows, for someone who can’t see it.",
  "alt-too-long": "Keep what it shows under 200 characters.",
  "too-many-images": "A build holds up to 30 pictures. Remove one first.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

export type BuilderRoutesDeps = {
  readonly builder: BuilderDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
};

const versionOf = (text: string | undefined): number => (/^\d{1,6}$/.test(text ?? "") ? Number(text) : Number.NaN);

export function builderRoutes(deps: BuilderRoutesDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/builder" });
  const page = (id: Id | null) => (id ? `/builder/${id}` : "/builder");

  post("/builder", (actor, f) => builder.startBuild(deps.builder, actor, { organizationId: f["organizationId"] ?? "", name: f["name"] ?? "", brief: f["brief"] ?? "" }), {
    done: (made) => `/builder/${made.build.id}`,
    back: () => "/builder#start",
    message: (made) => (made.first.ok ? "Started. Claude is making the first version. This page updates when it’s ready." : `Started, but Claude wasn’t asked yet. ${messageFor(made.first.error)}`),
  });
  post("/builder/:id/ask", (actor, f, id) => builder.askClaude(deps.builder, actor, id as Id, f["ask"] ?? ""), { done: (_b, id) => page(id), back: (id) => `${page(id)}#ask`, message: "Sent. Claude is working on it. This page updates when it’s ready." });
  post("/builder/:id/brief", (actor, f, id) => builder.saveBrief(deps.builder, actor, id as Id, { name: f["name"] ?? "", brief: f["brief"] ?? "" }), { done: (_b, id) => `${page(id)}#brief`, back: (id) => `${page(id)}#brief`, message: "Saved. Claude uses it from the next request." });
  post("/builder/:id/restore", (actor, f, id) => builder.restoreVersion(deps.builder, actor, id as Id, versionOf(f["version"])), { done: (_b, id) => page(id), back: (id) => `${page(id)}#versions`, message: "Restored as the newest version." });
  post("/builder/:id/images", (actor, f, id, files) => builder.addImage(deps.builder, actor, id as Id, { kind: f["kind"] ?? "", alt: f["alt"] ?? "", bytes: files["image"]?.bytes ?? null }), { done: (_i, id) => `${page(id)}#images`, back: (id) => `${page(id)}#add-image`, message: "Added. Claude can use it from your next request." });
  post("/builder/:id/images/remove", (actor, f, id) => builder.removeImage(deps.builder, actor, id as Id, f["image"] ?? ""), { done: (_b, id) => `${page(id)}#images`, back: (id) => `${page(id)}#images`, message: "Removed. Ask Claude to take it off any page that shows it." });
  post("/builder/settings", (actor, f) => builder.saveBuilderSettings(deps.builder, actor, { model: f["model"] ?? "", cap: f["cap"] ?? "" }), { done: () => "/builder/settings", back: () => "/builder/settings", message: "Saved." });
  return app;
}

/**
 * GET /builder/:id/versions/:n/site.zip, for whoever may build; and
 * GET /builder/preview/:token/..., the preview frame's files.
 */
export function builderDownloads(deps: Pick<BuilderRoutesDeps, "builder" | "actorOf">): Hono {
  const app = new Hono();
  const missing = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  app.get("/builder/:id/versions/:n/site.zip", (c) => {
    const id = parseId(c.req.param("id"));
    if (!id.ok) return missing();
    const made = builder.versionZip(deps.builder, deps.actorOf(c.req.header("cookie") ?? ""), id.value, versionOf(c.req.param("n")));
    if (!made.ok) return missing();
    return new Response(made.value.bytes, { status: 200, headers: { "content-type": "application/zip", "content-length": String(made.value.bytes.length), "content-disposition": `attachment; filename="${made.value.name}"`, "cache-control": "no-store" } });
  });
  // A build's picture, for its thumbnail. Its bytes never change under its id.
  app.get("/builder/:id/images/:image", (c) => {
    const id = parseId(c.req.param("id"));
    const image = parseId(c.req.param("image"));
    const found = id.ok && image.ok ? builder.imageFor(deps.builder, deps.actorOf(c.req.header("cookie") ?? ""), id.value, image.value) : null;
    if (!found) return missing();
    return new Response(new Uint8Array(found.body), { status: 200, headers: { "content-type": found.contentType, "content-length": String(found.body.length), "cache-control": "private, max-age=86400, immutable", "content-security-policy": "default-src 'none'; sandbox" } });
  });
  // The frame's address without its trailing slash: add it, so the site's relative links resolve under the token.
  app.get("/builder/preview/:token", (c) => c.redirect(`/builder/preview/${encodeURIComponent(c.req.param("token"))}/`, 302));
  app.get("/builder/preview/:token/*", (c) => {
    const token = c.req.param("token");
    const prefix = `/builder/preview/${token}/`;
    const path = c.req.path.startsWith(prefix) ? decodeURIComponent(c.req.path.slice(prefix.length)) : "";
    const file = builder.previewFile(deps.builder, token, path);
    if (!file) return missing();
    return new Response(typeof file.content === "string" ? file.content : new Uint8Array(file.content), {
      status: 200,
      headers: {
        "content-type": file.type,
        "cache-control": "private, no-store",
        "referrer-policy": "no-referrer",
        // The frame is an origin of its own, so its fetch of content/site.json is cross-origin. The address is the key and no cookies go with it.
        "access-control-allow-origin": "*",
        // Shown only inside HQ's own page, and only in a sandbox of its own: no
        // cookies, no HQ pages, no forms, no windows, nothing from elsewhere.
        "x-frame-options": "SAMEORIGIN",
        "content-security-policy":
          "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
      },
    });
  });
  return app;
}
