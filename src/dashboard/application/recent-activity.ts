// The dashboard's recent-activity panel.
//
// Permission: `dashboard.view` and `activity.view`. A viewer who also holds
// `activity.view-all` sees every event, including sign-ins and user changes.
// Everyone else sees activity on client records only.
//
// Reading changes nothing, so it writes no activity event.
import { describeEvent, FEED_LIMIT, type FeedScope } from "../domain/activity-feed.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, type Id, type Result } from "../../shared/index.ts";
import type { ActivityReader } from "./ports.ts";

export type ActivityItemView = {
  readonly id: string;
  /** "Mikey Nichols signed in" */
  readonly text: string;
  /** "Nov 14, 2026, 9:03 PM" in the business time zone. */
  readonly when: string;
  /** The same moment as a UTC ISO 8601 instant, for <time datetime>. */
  readonly whenIso: string;
};

export type ActivityFeedView = {
  readonly items: readonly ActivityItemView[];
  /** True when the viewer sees sign-ins and user changes too. */
  readonly everything: boolean;
};

export type RecentActivityDeps = {
  readonly users: IdentityUserStore;
  readonly activity: ActivityReader;
  /** Formats a UTC instant for people, in the business time zone. */
  readonly formatWhen: (instant: string) => string;
};

export function recentActivity(deps: RecentActivityDeps, actorId: Id | null): Result<ActivityFeedView, "forbidden"> {
  if (!authorize(deps, actorId, "dashboard.view").ok) return err("forbidden");
  if (!authorize(deps, actorId, "activity.view").ok) return err("forbidden");

  const scope: FeedScope = authorize(deps, actorId, "activity.view-all").ok ? "everything" : "client-records";
  const items = deps.activity.recent(scope, FEED_LIMIT).map((row) => ({
    id: row.id,
    text: describeEvent(row.action, row.actorName),
    when: deps.formatWhen(row.occurredAt),
    whenIso: row.occurredAt,
  }));
  return ok({ items, everything: scope === "everything" });
}

/** The records that show their own history, and what it takes to see each. */
const HISTORY_PERMISSION: Readonly<Record<string, string>> = {
  "client-organization": "client.view",
  opportunity: "opportunity.view",
  invoice: "invoice.view",
  task: "task.view",
  proposal: "proposal.view",
};

/** The most events a record's history shows. */
export const HISTORY_LIMIT = 15;

/**
 * What changed on one record (quality of life, 2026-11-25): its events from
 * the activity log, newest first, for someone who may see the record.
 * Reading changes nothing, so it writes no activity event.
 */
export function recordHistory(deps: RecentActivityDeps, actorId: Id | null, recordType: string, recordId: string): readonly ActivityItemView[] {
  const permission = HISTORY_PERMISSION[recordType];
  if (!permission || !authorize(deps, actorId, permission).ok) return [];
  return deps.activity.forRecord(recordType, recordId, HISTORY_LIMIT).map((row) => ({ id: row.id, text: describeEvent(row.action, row.actorName), when: deps.formatWhen(row.occurredAt), whenIso: row.occurredAt }));
}
