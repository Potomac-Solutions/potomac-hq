// A build: a website being made in HQ for one client (decision 0010,
// section 1), and the requests that make its versions.
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type Build = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly name: string;
  readonly brief: string;
  readonly createdBy: Id;
  readonly createdAt: string;
  /** Where it was reworked from, like github.com/owner/name or an address; "" for a new site. */
  readonly referenceFrom?: string;
};

export type BuildVersion = {
  readonly buildId: Id;
  readonly number: number;
  /** The request that made it, or null for one restored by a person. */
  readonly requestId: Id | null;
  /** Who restored it, when a person did. */
  readonly madeBy: Id | null;
  readonly summary: string;
  /** The files as JSON (see files.ts). */
  readonly filesJson: string;
  readonly chars: number;
  readonly createdAt: string;
};

export const REQUEST_STATES = ["working", "done", "failed"] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export type BuildRequest = {
  readonly id: Id;
  readonly buildId: Id;
  readonly askedBy: Id;
  readonly ask: string;
  readonly model: string;
  readonly state: RequestState;
  /** The worst case reserved under the cap while it runs. */
  readonly reservedMicros: number;
  /** What it really cost, once known. While working, 0. */
  readonly costMicros: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Why it failed, as a code. */
  readonly error: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
};

export const MAX_NAME = 80;
export const MAX_BRIEF = 4_000;
export const MAX_ASK = 2_000;

export type BuildError = "name-missing" | "name-too-long" | "brief-too-long" | "ask-missing" | "ask-too-long";

export function checkBuildInput(input: { readonly name: string; readonly brief: string }): Result<{ readonly name: string; readonly brief: string }, BuildError> {
  const name = input.name.replace(/\s+/g, " ").trim();
  const brief = input.brief.replace(/\r\n/g, "\n").trim();
  if (!name) return err("name-missing");
  if (name.length > MAX_NAME) return err("name-too-long");
  if (brief.length > MAX_BRIEF) return err("brief-too-long");
  return ok({ name, brief });
}

export function checkAsk(text: string): Result<string, BuildError> {
  const ask = text.replace(/\r\n/g, "\n").trim();
  if (!ask) return err("ask-missing");
  if (ask.length > MAX_ASK) return err("ask-too-long");
  return ok(ask);
}

/** What the first request asks for, when a build starts. */
export const FIRST_ASK = "Make the first version of this website from the brief and the client's facts.";

/** A request still working after this long was lost (the server restarted, say). */
export const LOST_AFTER_MS = 20 * 60_000;

/** The first instant of the month an instant falls in, in a time zone, as UTC ISO text. */
export function monthStart(instant: string, timeZone: string): string {
  const local = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone);
  return local.with({ day: 1 }).startOfDay().toInstant().toString();
}
