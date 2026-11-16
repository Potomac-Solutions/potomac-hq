// The full audit history, with filters (roadmap v1.0).
//
// Permission: `activity.view-all`, which only an admin holds. Reading changes
// nothing, so it writes no activity event.
import { AUDIT_PAGE_SIZE, auditQuery, contextLine, dayAfter, pageCount } from "../domain/audit.ts";
import { describeEvent } from "../domain/activity-feed.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, type Id, type Result } from "../../shared/index.ts";
import type { AuditReader } from "./ports.ts";

export type AuditDeps = {
  readonly users: IdentityUserStore;
  readonly audit: AuditReader;
  readonly formatWhen: (instant: string) => string;
  /** The UTC instant a business day starts at. */
  readonly startOfDay: (day: string) => string;
};

export type AuditView = {
  readonly items: readonly { readonly id: string; readonly text: string; readonly when: string; readonly whenIso: string; readonly record: string; readonly detail: string }[];
  readonly total: number;
  readonly page: number;
  readonly pages: number;
  /** The address of the page before and after, or "" when there is none. */
  readonly previous: string;
  readonly next: string;
  readonly filter: { readonly actor: string; readonly recordType: string; readonly action: string; readonly from: string; readonly to: string };
  readonly filtered: boolean;
  readonly people: readonly { readonly value: string; readonly label: string }[];
  readonly recordTypes: readonly string[];
  readonly exportHref: string;
};

type Raw = { readonly actor?: string; readonly recordType?: string; readonly action?: string; readonly from?: string; readonly to?: string; readonly page?: string };

function searchFilter(deps: AuditDeps, query: ReturnType<typeof auditQuery>) {
  return {
    actor: query.actor,
    recordType: query.recordType,
    action: query.action,
    from: query.from ? deps.startOfDay(query.from) : "",
    until: query.to ? deps.startOfDay(dayAfter(query.to)) : "",
  };
}

export function auditHistory(deps: AuditDeps, actorId: Id | null, raw: Raw): Result<AuditView, "forbidden"> {
  if (!authorize(deps, actorId, "activity.view-all").ok) return err("forbidden");
  const query = auditQuery(raw);
  const filter = searchFilter(deps, query);
  const total = deps.audit.count(filter);
  const pages = pageCount(total);
  const page = Math.min(query.page, pages);
  const address = (to: number) => {
    const params = new URLSearchParams();
    for (const key of ["actor", "recordType", "action", "from", "to"] as const) if (query[key]) params.set(key, query[key]);
    if (to > 1) params.set("page", String(to));
    const text = params.toString();
    return text ? `/activity?${text}` : "/activity";
  };
  return ok({
    items: deps.audit.search(filter, AUDIT_PAGE_SIZE, (page - 1) * AUDIT_PAGE_SIZE).map((row) => ({
      id: row.id,
      text: describeEvent(row.action, row.actorName),
      when: deps.formatWhen(row.occurredAt),
      whenIso: row.occurredAt,
      record: `${row.action} · ${row.recordType} ${row.recordId.slice(0, 8)}`,
      detail: contextLine(row.context),
    })),
    total,
    page,
    pages,
    previous: page > 1 ? address(page - 1) : "",
    next: page < pages ? address(page + 1) : "",
    filter: { actor: query.actor, recordType: query.recordType, action: query.action, from: query.from, to: query.to },
    filtered: Boolean(query.actor || query.recordType || query.action || query.from || query.to),
    people: [...deps.users.list().map((user) => ({ value: user.id as string, label: user.name })), { value: "none", label: "Nobody signed in to HQ (a client, or HQ itself)" }],
    recordTypes: deps.audit.recordTypes(),
    exportHref: address(1).replace("/activity", "/activity.csv"),
  });
}

export type AuditTable = { readonly header: readonly string[]; readonly rows: readonly (readonly string[])[] };

/** Every matching event, oldest last, for a CSV. The same permission as the page. */
export function auditTable(deps: AuditDeps, actorId: Id | null, raw: Raw): Result<AuditTable, "forbidden"> {
  if (!authorize(deps, actorId, "activity.view-all").ok) return err("forbidden");
  const filter = searchFilter(deps, auditQuery(raw));
  const rows = deps.audit.search(filter, 100_000, 0).map((row) => [row.occurredAt, row.actorName ?? "", row.action, row.recordType, row.recordId, row.context]);
  return ok({ header: ["When (UTC)", "Who", "Action", "Record type", "Record", "Context"], rows });
}
