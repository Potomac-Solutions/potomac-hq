// Webhooks (decision 0007, section 12). An admin (`webhook.manage`) adds an
// https address and the events to send it. When one of those happens, HQ
// queues a delivery in the same transaction (`withWebhooks` wraps the
// activity log); a job sends what's due, signed with HMAC-SHA256, and tries
// again with a growing wait for a day. Each webhook keeps its last 200
// deliveries and the answers they got.
//
// The signing secret is never stored: it is worked out from HQ's own key and
// a random salt kept with the webhook, shown once when it's made, and
// replaced by making a new salt.
import { delivered, DELIVERIES_KEPT, HOOK_EVENT_LABELS, HOOK_EVENTS, hookEventsFrom, nextTry, readWebhook, type HookEvent, type HookOccurrence, type Webhook, type WebhookError } from "../domain/webhook.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type ActivityLog, type Clock, type Id, type IdSource, type Result, type Transact } from "../../shared/index.ts";

export type DeliveryState = "pending" | "delivered" | "failed";

export type Delivery = {
  readonly id: Id;
  readonly webhookId: Id;
  readonly event: string;
  /** The JSON sent, exactly. */
  readonly payload: string;
  readonly createdAt: string;
  readonly state: DeliveryState;
  readonly attempts: number;
  /** When to try next, while pending. */
  readonly nextAt: string | null;
  readonly lastTriedAt: string | null;
  /** The HTTP status of the last answer, or null when there was none. */
  readonly lastStatus: number | null;
  /** The start of the last answer, or why there wasn't one. */
  readonly lastAnswer: string;
};

export type WebhookStore = {
  insert(webhook: Webhook): void;
  update(webhook: Webhook): void;
  /** Deletes it and its deliveries. */
  remove(id: Id): void;
  get(id: Id): Webhook | null;
  list(): Webhook[];
  /** Webhooks not paused that are sent this event. */
  forEvent(event: HookEvent): Webhook[];
};

export type DeliveryStore = {
  insert(delivery: Delivery): void;
  update(delivery: Delivery): void;
  /** Pending deliveries due by `now`, of webhooks not paused, oldest first. */
  due(now: string, limit: number): Delivery[];
  /** A webhook's deliveries, newest first. */
  forWebhook(webhookId: Id, limit: number): Delivery[];
  /** Keeps only a webhook's newest `keep`. */
  prune(webhookId: Id, keep: number): void;
};

export type WebhookSigner = {
  newSalt(): string;
  /** The signing secret for a webhook, from HQ's key and its salt. */
  secretFor(webhook: Pick<Webhook, "id" | "salt">): string;
  /** Hex HMAC-SHA256 of the body with the secret. */
  sign(secret: string, body: string): string;
};

/** One POST. Never follows a redirect; refuses addresses inside a network. */
export type HookSend = (url: string, body: string, headers: Readonly<Record<string, string>>) => Promise<{ readonly status: number; readonly answer: string } | { readonly error: string }>;

/** What a payload says about its task or project, read when it happens. */
export type HookDescribe = {
  task(id: Id): Readonly<Record<string, unknown>> | null;
  project(id: Id): Readonly<Record<string, unknown>> | null;
};

export type WebhooksDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly webhooks: WebhookStore;
  readonly deliveries: DeliveryStore;
  /** Null when HQ has no key to sign with: webhooks can't be added. */
  readonly signer: WebhookSigner | null;
  readonly describe: HookDescribe;
};

type Refused = "forbidden" | "not-found";
const allowed = (deps: Pick<WebhooksDeps, "users">, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "webhook.manage").ok;

/** The JSON for one delivery. */
function payloadOf(deps: Pick<WebhooksDeps, "describe" | "users">, deliveryId: Id, occurrence: HookOccurrence | { readonly event: "webhook.test" }, occurredAt: string, actorId: Id | null): string {
  const by = actorId ? deps.users.get(actorId) : null;
  const subject =
    "subject" in occurrence
      ? occurrence.subject.kind === "task"
        ? { task: deps.describe.task(occurrence.subject.id) }
        : { project: deps.describe.project(occurrence.subject.id) }
      : {};
  return JSON.stringify({
    id: deliveryId,
    event: occurrence.event,
    occurredAt,
    by: by ? { name: by.name, email: by.email } : null,
    ...subject,
    ...("details" in occurrence ? occurrence.details : {}),
  });
}

/**
 * An activity log that also queues a delivery for each webhook sent what an
 * event is, in the same transaction. Wire it where tasks, to-dos, comments
 * and projects are recorded.
 */
export function withWebhooks(log: ActivityLog, deps: Pick<WebhooksDeps, "webhooks" | "deliveries" | "describe" | "users"> & { readonly newId: IdSource; readonly clock: Clock }): ActivityLog {
  return {
    append(event) {
      log.append(event);
      for (const occurrence of hookEventsFrom(event)) {
        for (const webhook of deps.webhooks.forEvent(occurrence.event)) {
          const id = deps.newId();
          deps.deliveries.insert({ id, webhookId: webhook.id, event: occurrence.event, payload: payloadOf(deps, id, occurrence, event.occurredAt, event.actorId), createdAt: event.occurredAt, state: "pending", attempts: 0, nextAt: event.occurredAt, lastTriedAt: null, lastStatus: null, lastAnswer: "" });
          deps.deliveries.prune(webhook.id, DELIVERIES_KEPT);
        }
      }
    },
  };
}

const EVENT_CHOICES = HOOK_EVENTS.map((event) => ({ value: event, label: HOOK_EVENT_LABELS[event] }));
const STATE_TEXT: Record<DeliveryState, string> = { pending: "Waiting to try again", delivered: "Delivered", failed: "Gave up" };

export type WebhookLine = {
  readonly id: string;
  readonly url: string;
  readonly events: readonly string[];
  readonly paused: boolean;
  /** The newest delivery, in words, or empty. */
  readonly last: string;
  readonly lastOk: boolean;
};

export type WebhooksView = { readonly ready: boolean; readonly items: readonly WebhookLine[]; readonly choices: typeof EVENT_CHOICES };

export function listWebhooks(deps: WebhooksDeps, actorId: Id | null, formatWhen: (at: string) => string): Result<WebhooksView, "forbidden"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return ok({
    ready: deps.signer !== null,
    choices: EVENT_CHOICES,
    items: deps.webhooks.list().map((hook) => {
      const last = deps.deliveries.forWebhook(hook.id, 1)[0];
      return {
        id: hook.id,
        url: hook.url,
        events: hook.events.map((event) => HOOK_EVENT_LABELS[event]),
        paused: hook.paused,
        last: last ? `${STATE_TEXT[last.state]}: ${last.event}, ${formatWhen(last.lastTriedAt ?? last.createdAt)}` : "Nothing sent yet",
        lastOk: !last || last.state !== "failed",
      };
    }),
  });
}

export type WebhookDetailView = {
  readonly id: string;
  readonly url: string;
  readonly paused: boolean;
  readonly choices: readonly { readonly value: string; readonly label: string; readonly on: boolean }[];
  readonly deliveries: readonly { readonly id: string; readonly event: string; readonly when: string; readonly state: string; readonly ok: boolean; readonly attempts: number; readonly answer: string; readonly next: string; readonly payload: string }[];
};

export function webhookDetail(deps: WebhooksDeps, actorId: Id | null, webhookId: Id, formatWhen: (at: string) => string): Result<WebhookDetailView, Refused> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const hook = deps.webhooks.get(webhookId);
  if (!hook) return err("not-found");
  return ok({
    id: hook.id,
    url: hook.url,
    paused: hook.paused,
    choices: EVENT_CHOICES.map((choice) => ({ ...choice, on: hook.events.includes(choice.value) })),
    deliveries: deps.deliveries.forWebhook(hook.id, DELIVERIES_KEPT).map((one) => ({
      id: one.id,
      event: one.event,
      when: formatWhen(one.createdAt),
      state: STATE_TEXT[one.state],
      ok: one.state === "delivered",
      attempts: one.attempts,
      answer: one.attempts === 0 ? "Not tried yet" : `${one.lastStatus ?? "No answer"}${one.lastAnswer ? `: ${one.lastAnswer}` : ""}`,
      next: one.state === "pending" && one.nextAt ? formatWhen(one.nextAt) : "",
      payload: one.payload,
    })),
  });
}

/** Adds a webhook. Answers its signing secret, to be shown once. */
export function addWebhook(deps: WebhooksDeps, actorId: Id | null, input: { readonly url: string; readonly events: readonly string[] }): Result<{ readonly webhook: Webhook; readonly secret: string }, "forbidden" | "not-ready" | WebhookError> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const signer = deps.signer;
  if (!signer) return err("not-ready");
  const read = readWebhook(input);
  if (!read.ok) return read;
  return deps.transact(() => {
    const webhook: Webhook = { id: deps.newId(), url: read.value.url, events: read.value.events, paused: false, salt: signer.newSalt(), createdBy: actorId, createdAt: deps.clock() };
    deps.webhooks.insert(webhook);
    recordActivity(deps, { actorId, action: "webhook.added", recordType: "webhook", recordId: webhook.id, context: { url: webhook.url, events: [...webhook.events] } });
    return ok({ webhook, secret: signer.secretFor(webhook) });
  });
}

/** Changes its address or events. */
export function changeWebhook(deps: WebhooksDeps, actorId: Id | null, webhookId: Id, input: { readonly url: string; readonly events: readonly string[] }): Result<Webhook, Refused | "unchanged" | WebhookError> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const read = readWebhook(input);
  if (!read.ok) return read;
  return deps.transact(() => {
    const hook = deps.webhooks.get(webhookId);
    if (!hook) return err("not-found");
    if (hook.url === read.value.url && hook.events.join() === read.value.events.join()) return err("unchanged");
    const next = { ...hook, url: read.value.url, events: read.value.events };
    deps.webhooks.update(next);
    recordActivity(deps, { actorId, action: "webhook.changed", recordType: "webhook", recordId: hook.id, context: { url: next.url, events: [...next.events], was: hook.url } });
    return ok(next);
  });
}

/** Pauses or resumes it. While paused nothing new is queued, and what's waiting waits. */
export function setWebhookPaused(deps: WebhooksDeps, actorId: Id | null, webhookId: Id, paused: boolean): Result<Webhook, Refused | "unchanged"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const hook = deps.webhooks.get(webhookId);
    if (!hook) return err("not-found");
    if (hook.paused === paused) return err("unchanged");
    const next = { ...hook, paused };
    deps.webhooks.update(next);
    recordActivity(deps, { actorId, action: paused ? "webhook.paused" : "webhook.resumed", recordType: "webhook", recordId: hook.id, context: { url: hook.url } });
    return ok(next);
  });
}

/** A new signing secret, shown once; the old one stops being used at once. */
export function replaceWebhookSecret(deps: WebhooksDeps, actorId: Id | null, webhookId: Id): Result<{ readonly webhook: Webhook; readonly secret: string }, Refused | "not-ready"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const signer = deps.signer;
  if (!signer) return err("not-ready");
  return deps.transact(() => {
    const hook = deps.webhooks.get(webhookId);
    if (!hook) return err("not-found");
    const next = { ...hook, salt: signer.newSalt() };
    deps.webhooks.update(next);
    recordActivity(deps, { actorId, action: "webhook.secret-replaced", recordType: "webhook", recordId: hook.id, context: { url: hook.url } });
    return ok({ webhook: next, secret: signer.secretFor(next) });
  });
}

export function removeWebhook(deps: WebhooksDeps, actorId: Id | null, webhookId: Id): Result<Webhook, Refused> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const hook = deps.webhooks.get(webhookId);
    if (!hook) return err("not-found");
    deps.webhooks.remove(webhookId);
    recordActivity(deps, { actorId, action: "webhook.removed", recordType: "webhook", recordId: hook.id, context: { url: hook.url } });
    return ok(hook);
  });
}

/** Queues a test delivery, sent with the next run. */
export function testWebhook(deps: WebhooksDeps, actorId: Id | null, webhookId: Id): Result<Webhook, Refused> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const hook = deps.webhooks.get(webhookId);
    if (!hook) return err("not-found");
    const id = deps.newId();
    const at = deps.clock();
    deps.deliveries.insert({ id, webhookId: hook.id, event: "webhook.test", payload: payloadOf(deps, id, { event: "webhook.test" }, at, actorId), createdAt: at, state: "pending", attempts: 0, nextAt: at, lastTriedAt: null, lastStatus: null, lastAnswer: "" });
    deps.deliveries.prune(hook.id, DELIVERIES_KEPT);
    recordActivity(deps, { actorId, action: "webhook.tested", recordType: "webhook", recordId: hook.id, context: { url: hook.url } });
    return ok(hook);
  });
}

const ANSWER_KEPT = 500;

/** Sends every delivery that's due, once each this run. Answers how many went and how many didn't. */
export async function deliverDue(deps: WebhooksDeps, send: HookSend): Promise<{ readonly delivered: number; readonly failed: number }> {
  const signer = deps.signer;
  if (!signer) return { delivered: 0, failed: 0 };
  let ok = 0;
  let failed = 0;
  for (const delivery of deps.deliveries.due(deps.clock(), 50)) {
    const hook = deps.webhooks.get(delivery.webhookId);
    if (!hook) continue;
    const signature = signer.sign(signer.secretFor(hook), delivery.payload);
    const answer = await send(hook.url, delivery.payload, {
      "content-type": "application/json",
      "user-agent": "PotomacHQ/1 (webhooks)",
      "x-hq-event": delivery.event,
      "x-hq-delivery": delivery.id,
      "x-hq-signature-256": `sha256=${signature}`,
    });
    const now = deps.clock();
    const attempts = delivery.attempts + 1;
    const status = "status" in answer ? answer.status : null;
    const text = ("status" in answer ? answer.answer : answer.error).slice(0, ANSWER_KEPT);
    if (delivered(status)) {
      deps.deliveries.update({ ...delivery, state: "delivered", attempts, nextAt: null, lastTriedAt: now, lastStatus: status, lastAnswer: text });
      ok += 1;
    } else {
      const next = nextTry(attempts, delivery.createdAt, now);
      deps.deliveries.update({ ...delivery, state: next ? "pending" : "failed", attempts, nextAt: next, lastTriedAt: now, lastStatus: status, lastAnswer: text });
      failed += 1;
    }
  }
  return { delivered: ok, failed };
}
