// Downloads. There is no address that maps to a place on disk: a file is
// reached only by its id, through the service that checks who is asking.
import { Hono } from "hono";
import { openFile, openFileForClient, type FilesDeps, type OpenedFile } from "../application/files.ts";
import { parseId, type Id } from "../../shared/index.ts";

export type FileRoutesDeps = {
  readonly files: FilesDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  /** The signed-in portal client, or null. */
  readonly clientOf: (cookieHeader: string) => { readonly clientUserId: Id; readonly organizationId: Id } | null;
};

/** Always a download, never shown in the page, and never run. */
function send(file: OpenedFile): Response {
  const fallback = file.record.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(file.body), {
    status: 200,
    headers: {
      "content-type": file.record.contentType,
      "content-length": String(file.body.length),
      "content-disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(file.record.name)}`,
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}

export function fileRoutes(deps: FileRoutesDeps): Hono {
  const app = new Hono();
  const missing = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

  app.get("/files/:id", (c) => {
    const id = parseId(c.req.param("id"));
    if (!id.ok) return missing();
    const opened = openFile(deps.files, deps.actorOf(c.req.header("cookie") ?? ""), id.value);
    // Refused and missing look the same, so an id cannot be probed.
    return opened.ok ? send(opened.value) : missing();
  });

  app.get("/portal/files/:id", (c) => {
    const id = parseId(c.req.param("id"));
    if (!id.ok) return missing();
    const opened = openFileForClient(deps.files, deps.clientOf(c.req.header("cookie") ?? ""), id.value);
    return opened.ok ? send(opened.value) : missing();
  });

  return app;
}
