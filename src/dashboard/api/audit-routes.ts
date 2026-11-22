// The audit history as a CSV download, with the same filters as the page.
import { Hono } from "hono";
import { auditTable, type AuditDeps } from "../application/audit-history.ts";
import { toCsv, type Id } from "../../shared/index.ts";

export function auditDownloads(deps: { readonly audit: AuditDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly today: () => string }): Hono {
  const app = new Hono();
  app.get("/activity.csv", (c) => {
    const q = (name: string) => c.req.query(name) ?? "";
    const made = auditTable(deps.audit, deps.actorOf(c.req.header("cookie") ?? ""), { actor: q("actor"), recordType: q("recordType"), action: q("action"), from: q("from"), to: q("to") });
    if (!made.ok) return c.text("Not found", 404);
    return new Response(toCsv(made.value.header, made.value.rows), {
      status: 200,
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="hq-audit-${deps.today()}.csv"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
    });
  });
  return app;
}
