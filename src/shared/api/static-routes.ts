import { Hono } from "hono";

export type StaticRoutesDeps = {
  readonly assets: ReadonlyMap<string, { readonly body: Uint8Array<ArrayBuffer>; readonly type: string }>;
  /** True when HQ can read its database. The health check answers 503 when it cannot. */
  readonly healthy?: () => boolean;
  /** The web app manifest, for installing HQ on a phone. */
  readonly manifest?: string;
};

/** The health check and the static files. Neither needs a session. */
export function staticRoutes(deps: StaticRoutesDeps): Hono {
  const app = new Hono();

  // Railway asks this before sending traffic to a new deploy, and an uptime
  // monitor can ask it from outside. It says nothing about what HQ holds.
  app.get("/healthz", (c) => {
    let ok = true;
    try {
      ok = deps.healthy ? deps.healthy() : true;
    } catch {
      ok = false;
    }
    return c.json({ ok }, ok ? 200 : 503, { "cache-control": "no-store" });
  });

  app.get("/assets/:name", (c) => {
    const asset = deps.assets.get(c.req.param("name"));
    if (!asset) return c.notFound();
    return c.body(asset.body, 200, { "content-type": asset.type, "cache-control": "public, max-age=3600" });
  });

  // Installing HQ on a phone (quality of life, 2026-11-25): the manifest, and
  // the service worker at the top of the site so it covers every page.
  app.get("/manifest.webmanifest", (c) => c.body(deps.manifest ?? "{}", 200, { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" }));
  app.get("/sw.js", (c) => {
    const worker = deps.assets.get("sw.js");
    if (!worker) return c.notFound();
    return c.body(worker.body, 200, { "content-type": worker.type, "cache-control": "no-cache" });
  });

  app.get("/favicon.ico", (c) => {
    const mark = deps.assets.get("potomac-mark.webp");
    if (!mark) return c.notFound();
    return c.body(mark.body, 200, { "content-type": mark.type, "cache-control": "public, max-age=86400" });
  });

  return app;
}
