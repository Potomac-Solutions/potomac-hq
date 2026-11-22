// The helper every use case calls to write its activity event. Call it inside
// the same transaction as the change it describes, so both are saved or
// neither is.
import { activityEvent, type ActivityDraft, type ActivityEvent } from "../domain/activity.ts";
import type { ActivityLog, Clock, IdSource } from "./ports.ts";

export type ActivityDeps = {
  readonly activityLog: ActivityLog;
  readonly clock: Clock;
  readonly newId: IdSource;
};

/**
 * A draft that fails the domain's checks is a programming mistake in the
 * calling use case, not something a user can cause, so it throws. Thrown
 * inside a transaction, it also undoes the change that was about to go
 * unrecorded.
 */
export class InvalidActivityError extends Error {
  readonly code: string;
  constructor(code: string, action: string) {
    super(`Activity event refused (${code}) for action "${action}"`);
    this.name = "InvalidActivityError";
    this.code = code;
  }
}

export function recordActivity(deps: ActivityDeps, draft: ActivityDraft): ActivityEvent {
  const result = activityEvent(draft, { id: deps.newId(), occurredAt: deps.clock() });
  if (!result.ok) throw new InvalidActivityError(result.error, draft.action);
  deps.activityLog.append(result.value);
  return result.value;
}
