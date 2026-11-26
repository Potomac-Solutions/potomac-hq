// The handoff pack download (2026-11-26).
import { Hono } from "hono";
import { handoffPack, type HandoffDeps } from "../application/handoff.ts";
import { parseId, type Id } from "../../shared/index.ts";

export function handoffDownloads(deps: { readonly handoff: HandoffDeps; readonly actorOf: (cookieHeader: string) => Id | null }): Hono {
  const app = new Hono();
  app.get("/clients/:id/handoff.zip", (c) => {
    const id = parseId(c.req.param("id"));
    const made = id.ok ? handoffPack(deps.handoff, deps.actorOf(c.req.header("cookie") ?? ""), id.value) : null;
    if (!made || !made.ok) return c.text("Not found", 404);
    return new Response(made.value.bytes, {
      status: 200,
      headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${made.value.fileName}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
    });
  });
  return app;
}
