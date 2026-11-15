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
