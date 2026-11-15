// The audit record. One is written for every change to a record and for every
// sign-in (docs/data-model.md). This file decides what a valid event is.
import type { Id } from "./id.ts";
import { err, ok, type Result } from "./result.ts";

export type ContextValue =
  | string
  | number
  | boolean
  | null
  | readonly ContextValue[]
  | { readonly [key: string]: ContextValue };
export type Context = { readonly [key: string]: ContextValue };

export type ActivityDraft = {
  /** Who did it. null only for actions HQ takes by itself. */
  readonly actorId: Id | null;
  /** A fixed key such as "opportunity.stage-changed". */
  readonly action: string;
  /** The kind of record acted on, such as "opportunity". */
  readonly recordType: string;
  readonly recordId: Id;
  /** What changed, for example the old and new stage. Never a secret. */
  readonly context?: Context;
};

export type ActivityEvent = {
  readonly id: Id;
  /** UTC instant as ISO 8601 text, set by the server. */
  readonly occurredAt: string;
  readonly actorId: Id | null;
  readonly action: string;
  readonly recordType: string;
  readonly recordId: Id;
  readonly context: Context;
};

export type ActivityError = "invalid-action" | "invalid-record-type" | "sensitive-context" | "invalid-context";

const NAME = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";
const ACTION = new RegExp(`^${NAME}(?:\\.${NAME})+$`);
const RECORD_TYPE = new RegExp(`^${NAME}$`);

// Sensitive values are referenced, never copied in. A context key that names
// one of these is refused, at any depth.
const SENSITIVE_KEY =
  /password|passphrase|passcode|^pass$|secret|token|cookie|session|authori[sz]ation|api[-_]?key|private[-_]?key|^card$|credit[-_]?card|card[-_]?(number|no)$|cvv|cvc|^ssn$|social[-_]?security|iban|routing|account[-_]?number/i;

export function activityEvent(
  draft: ActivityDraft,
  stamp: { readonly id: Id; readonly occurredAt: string },
): Result<ActivityEvent, ActivityError> {
  if (!ACTION.test(draft.action)) return err("invalid-action");
  if (!RECORD_TYPE.test(draft.recordType)) return err("invalid-record-type");
  const context = draft.context ?? {};
  const problem = contextProblem(context, 0);
  if (problem) return err(problem);
  return ok({
    id: stamp.id,
    occurredAt: stamp.occurredAt,
    actorId: draft.actorId,
    action: draft.action,
    recordType: draft.recordType,
    recordId: draft.recordId,
    context,
  });
}

const MAX_DEPTH = 6;

function contextProblem(value: unknown, depth: number): "sensitive-context" | "invalid-context" | null {
  if (depth > MAX_DEPTH) return "invalid-context";
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : "invalid-context";
  if (Array.isArray(value)) {
    for (const item of value) {
      const problem = contextProblem(item, depth + 1);
      if (problem) return problem;
    }
    return null;
  }
  if (typeof value !== "object") return "invalid-context";
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return "invalid-context";
  for (const [key, inner] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) return "sensitive-context";
    const problem = contextProblem(inner, depth + 1);
    if (problem) return problem;
  }
  return null;
}
