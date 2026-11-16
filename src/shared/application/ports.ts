// What application code needs from the outside world. Infrastructure provides
// these. Tests provide fakes.
import type { ActivityEvent } from "../domain/activity.ts";
import type { Id } from "../domain/id.ts";

/** The current moment as a UTC ISO 8601 instant. */
export type Clock = () => string;

export type IdSource = () => Id;

/** Runs fn so that everything it writes is saved together or not at all. */
export type Transact = <T>(fn: () => T) => T;

export type ActivityLog = {
  /** Adds one event. There is no update and no delete. */
  append(event: ActivityEvent): void;
};
