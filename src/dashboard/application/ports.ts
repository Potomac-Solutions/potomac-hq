import type { FeedScope } from "../domain/activity-feed.ts";

export type ActivityRow = {
  readonly id: string;
  readonly occurredAt: string;
  readonly action: string;
  /** The actor's name, or null when HQ acted by itself. */
  readonly actorName: string | null;
};

export type ActivityReader = {
  /** The newest events first, at most `limit`, within the scope. */
  recent(scope: FeedScope, limit: number): ActivityRow[];
  /** One record's events, newest first, at most `limit`. */
  forRecord(recordType: string, recordId: string, limit: number): ActivityRow[];
};

/** What the audit history may be narrowed by. An empty value means "any". */
export type AuditFilter = {
  /** A user's id, or "none" for events with no HQ user behind them. */
  readonly actor: string;
  readonly recordType: string;
  /** The start of an action: "invoice." or "user.signed-in". */
  readonly action: string;
  /** UTC instants. From is included, until is not. */
  readonly from: string;
  readonly until: string;
};

export type AuditRow = ActivityRow & { readonly recordType: string; readonly recordId: string; readonly context: string };

export type AuditReader = {
  /** The newest matching events first. */
  search(filter: AuditFilter, limit: number, offset: number): AuditRow[];
  count(filter: AuditFilter): number;
  /** Every record type that has an event, by name. */
  recordTypes(): string[];
};

/** One record that matched a search. */
export type SearchHit = {
  readonly id: string;
  /** What it is called: a client's name, a task's title, an invoice's number. */
  readonly name: string;
  /** What it belongs to, to tell two of the same name apart: "Mt. Storm Bakery", "Bakery website". */
  readonly context: string;
  /** For a task or a project: whether it is still open. For a contact: their email. */
  readonly extra: string;
  /** Where it opens. Only ever built from ids. */
  readonly href: string;
};

export type SearchKind = "clients" | "contacts" | "opportunities" | "projects" | "tasks" | "proposals" | "invoices" | "articles";

/** Reads records for search. It only ever selects. */
export type SearchReader = {
  /** Records of one kind whose words all appear in them, at most `limit`. */
  find(kind: SearchKind, words: readonly string[], limit: number): SearchHit[];
  invoiceByNumber(number: number): SearchHit | null;
};
