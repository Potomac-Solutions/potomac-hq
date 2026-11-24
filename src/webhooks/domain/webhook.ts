// Webhooks (decision 0007, section 12): HQ posting what happened to an
// address an admin chose, for n8n or anything like it. Each delivery is
// signed, retried with a growing wait for a day, and kept (the last 200 per
// webhook) with the answer it got.
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

/** What a webhook can be sent, in the words its receiver sees. */
export const HOOK_EVENTS = ["task.added", "task.assigned", "task.moved", "task.done", "task.commented", "project.added", "project.completed"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export const HOOK_EVENT_LABELS: Record<HookEvent, string> = {
  "task.added": "A task or to-do is added",
  "task.assigned": "A task is given to someone",
  "task.moved": "A task moves to another status",
  "task.done": "A task is done",
  "task.commented": "Someone comments on a task",
  "project.added": "A project is added",
  "project.completed": "A project is completed",
};

export type Webhook = {
  readonly id: Id;
  readonly url: string;
  readonly events: readonly HookEvent[];
  readonly paused: boolean;
  /** Mixed with HQ's key to make the signing secret; a new one makes a new secret. */
  readonly salt: string;
  readonly createdBy: Id;
  readonly createdAt: string;
};

export type WebhookError = "address-invalid" | "address-private" | "events-missing";

const isHookEvent = (value: string): value is HookEvent => (HOOK_EVENTS as readonly string[]).includes(value);

/**
 * Reads a webhook's address and events. https only, on the usual port, with
 * no sign-in in the address; numbers and names that can only be inside a
 * network are refused here, and every name is checked again when it's sent.
 */
export function readWebhook(input: { readonly url: string; readonly events: readonly string[] }): Result<{ readonly url: string; readonly events: readonly HookEvent[] }, WebhookError> {
  let url: URL;
  try {
    url = new URL(input.url.trim());
  } catch {
    return err("address-invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port !== "" && url.port !== "443") || url.toString().length > 500) return err("address-invalid");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) return err("address-private");
  const events = HOOK_EVENTS.filter((event) => input.events.includes(event));
  if (events.length === 0 || !input.events.every(isHookEvent)) return err("events-missing");
  url.hash = "";
  return ok({ url: url.toString(), events });
}

/** The parts of an activity event a webhook is read from. */
export type HookSource = { readonly action: string; readonly recordId: Id; readonly context: Readonly<Record<string, unknown>> };

/** What an event is about, for its payload. */
export type HookSubject = { readonly kind: "task" | "project"; readonly id: Id };

export type HookOccurrence = { readonly event: HookEvent; readonly subject: HookSubject; readonly details: Readonly<Record<string, unknown>> };

const text = (value: unknown) => (typeof value === "string" ? value : null);

/** The webhook events an activity event is. One activity can be two: a task moved to done is moved, and done. */
export function hookEventsFrom(source: HookSource): HookOccurrence[] {
  const task = (event: HookEvent, details: Record<string, unknown> = {}): HookOccurrence => ({ event, subject: { kind: "task", id: source.recordId }, details });
  const c = source.context;
  switch (source.action) {
    case "task.added":
    case "todo.added":
      return [task("task.added"), ...(text(c["assigneeId"]) ? [task("task.assigned")] : [])];
    case "task.edited":
      return text(c["assigneeId"]) && c["assigneeId"] !== c["assigneeWas"] ? [task("task.assigned")] : [];
    case "task.moved":
      return [task("task.moved", { from: c["from"], to: c["to"] }), ...(c["to"] === "done" ? [task("task.done")] : [])];
    case "todo.done":
      return [task("task.moved", { from: "todo", to: "done" }), task("task.done")];
    case "todo.reopened":
      return [task("task.moved", { from: "done", to: "todo" })];
    case "comment.added":
      return [task("task.commented", { comment: c["body"], ...(text(c["guestName"]) ? { throughShareLink: true, name: c["guestName"] } : {}) })];
    case "project.created":
      return [{ event: "project.added", subject: { kind: "project", id: source.recordId }, details: {} }];
    case "project.status-changed":
      return c["to"] === "completed" ? [{ event: "project.completed", subject: { kind: "project", id: source.recordId }, details: {} }] : [];
    default:
      return [];
  }
}

/** Waits between tries: a minute, five, fifteen, an hour, three, six and twelve. Within a day of the first, then it gives up. */
const RETRY_MINUTES = [1, 5, 15, 60, 180, 360, 720] as const;
const GIVE_UP_HOURS = 24;

/** When to try again after `attempts` tries, or null to give up. */
export function nextTry(attempts: number, firstAt: string, now: string): string | null {
  const wait = RETRY_MINUTES[attempts - 1];
  if (wait === undefined) return null;
  const at = Temporal.Instant.from(now).add({ minutes: wait });
  return Temporal.Instant.compare(at, Temporal.Instant.from(firstAt).add({ hours: GIVE_UP_HOURS })) > 0 ? null : at.toString();
}

/** A 2xx answer is delivered. Anything else, or no answer, is tried again. */
export const delivered = (status: number | null): boolean => status !== null && status >= 200 && status < 300;

/** How many deliveries each webhook keeps. */
export const DELIVERIES_KEPT = 200;
