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
