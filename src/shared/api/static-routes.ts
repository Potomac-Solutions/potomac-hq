import { Hono } from "hono";

export type StaticRoutesDeps = {
  readonly assets: ReadonlyMap<string, { readonly body: Uint8Array<ArrayBuffer>; readonly type: string }>;
};

/** The health check and the static files. Neither needs a session. */
export function staticRoutes(deps: StaticRoutesDeps): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/assets/:name", (c) => {
    const asset = deps.assets.get(c.req.param("name"));
    if (!asset) return c.notFound();
    return c.body(asset.body, 200, { "content-type": asset.type, "cache-control": "public, max-age=3600" });
  });

  app.get("/favicon.ico", (c) => {
    const mark = deps.assets.get("potomac-mark.webp");
    if (!mark) return c.notFound();
    return c.body(mark.body, 200, { "content-type": mark.type, "cache-control": "public, max-age=86400" });
  });

  return app;
}
