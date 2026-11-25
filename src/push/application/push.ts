// Phone alerts (quality of life, 2026-11-25). A person turns alerts on for
// each device from Settings; HQ queues an alert for them when a notice comes
// (a task given to them, a mention, a reminder), when a client writes in the
// portal or asks for a call, when a site goes down (admins), and before a
// booked call (its host). A job sends what's waiting every minute, holding
// alerts in the person's quiet hours. Permission: anyone signed in, for
// their own devices.
import { alertDecision, callAlert, eventAlert, noticeAlert, readDevice, type Alert, type Device, type DeviceError } from "../domain/push.ts";
import type { IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";

export type StoredDevice = Device & { readonly id: Id; readonly userId: Id; readonly createdAt: string };
export type QueuedAlert = Alert & { readonly id: Id; readonly userId: Id; readonly createdAt: string };

export type DeviceStore = {
  forUser(userId: Id): StoredDevice[];
  /** Adds the device, or moves it to this person if its endpoint was someone else's. */
  save(device: StoredDevice): void;
  remove(userId: Id, id: Id): boolean;
  removeEndpoint(endpoint: string): void;
  sent(id: Id, at: string): void;
  failed(id: Id): void;
};

export type AlertQueue = {
  /** Queues it unless this person already has an alert with that key. */
  add(alert: QueuedAlert): void;
  waiting(limit: number): QueuedAlert[];
  sent(id: Id, at: string): void;
  dropped(id: Id, at: string): void;
};

/** Where alerts come from, read since an instant. */
export type AlertSources = {
  notices(since: string): { readonly id: string; readonly userId: Id; readonly kind: string; readonly actorName: string; readonly taskTitle: string; readonly detail: string }[];
  events(since: string): { readonly id: string; readonly action: string; readonly recordId: string; readonly name: string; readonly ownerId: Id | null }[];
  /** Booked calls starting between two instants. */
  calls(from: string, to: string): { readonly id: string; readonly hostId: Id; readonly who: string; readonly startsAt: string }[];
};

export type Sender = (device: { readonly endpoint: string; readonly p256dh: string; readonly auth: string }, alert: { readonly title: string; readonly body: string; readonly url: string; readonly tag?: string }) => Promise<"sent" | "gone" | "failed">;

export type PushDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly devices: DeviceStore;
  readonly queue: AlertQueue;
  readonly sources: AlertSources;
  /** HQ's VAPID public key for browsers, or null when alerts aren't set up. */
  readonly publicKey: string | null;
  /** Whether it's quiet hours for this person now (their notice settings). */
  readonly quietNow: (userId: Id) => boolean;
  /** Formats a time for a person: "3:30 PM". */
  readonly timeOf: (instant: string) => string;
};

const signedIn = (deps: PushDeps, actorId: Id | null): actorId is Id => actorId !== null && deps.users.get(actorId)?.status === "active";

export type DevicesView = { readonly ready: boolean; readonly publicKey: string; readonly devices: readonly { readonly id: string; readonly label: string; readonly added: string }[] };

export function devicesFor(deps: PushDeps, actorId: Id | null, formatWhen: (at: string) => string): DevicesView {
  if (!signedIn(deps, actorId)) return { ready: false, publicKey: "", devices: [] };
  return { ready: deps.publicKey !== null, publicKey: deps.publicKey ?? "", devices: deps.devices.forUser(actorId).map((one) => ({ id: one.id, label: one.label || "A device", added: formatWhen(one.createdAt) })) };
}

export function addDevice(deps: PushDeps, actorId: Id | null, input: { readonly endpoint: string; readonly p256dh: string; readonly auth: string; readonly label: string }): Result<StoredDevice, "forbidden" | "not-set-up" | DeviceError> {
  if (!signedIn(deps, actorId)) return err("forbidden");
  if (deps.publicKey === null) return err("not-set-up");
  const device = readDevice(input);
  if (!device.ok) return device;
  return deps.transact(() => {
    const stored: StoredDevice = { ...device.value, id: deps.newId(), userId: actorId, createdAt: deps.clock() };
    deps.devices.save(stored);
    recordActivity(deps, { actorId, action: "push.device-added", recordType: "user", recordId: actorId, context: { label: stored.label } });
    return ok(stored);
  });
}

export function removeDevice(deps: PushDeps, actorId: Id | null, id: Id): Result<true, "forbidden" | "not-found"> {
  if (!signedIn(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    if (!deps.devices.remove(actorId, id)) return err("not-found");
    recordActivity(deps, { actorId, action: "push.device-removed", recordType: "user", recordId: actorId, context: {} });
    return ok(true as const);
  });
}

/** A test alert to all of this person's devices, sent on the next run. */
export function testAlert(deps: PushDeps, actorId: Id | null): Result<true, "forbidden" | "no-devices"> {
  if (!signedIn(deps, actorId)) return err("forbidden");
  if (deps.devices.forUser(actorId).length === 0) return err("no-devices");
  deps.queue.add({ id: deps.newId(), userId: actorId, key: `test:${deps.clock()}`, title: "Alerts from HQ work", body: "This is what they look like.", url: "/settings#alerts", createdAt: deps.clock() });
  return ok(true as const);
}

const ALERTED_ACTIONS_FOR_ADMINS = new Set(["site.down", "project.message-received", "call.requested"]);

/** Queues alerts from what happened since an instant, for people with a device. Never queues the same thing twice. */
export function queueAlerts(deps: PushDeps, since: string, until: string): number {
  const withDevices = new Set(deps.users.list().filter((user) => user.status === "active" && deps.devices.forUser(user.id).length > 0).map((user) => user.id));
  if (withDevices.size === 0) return 0;
  const admins = [...withDevices].filter((id) => deps.users.rolesOf(id).includes("admin"));
  const now = deps.clock();
  let queued = 0;
  const add = (userId: Id, alert: Alert) => {
    if (!withDevices.has(userId)) return;
    deps.queue.add({ ...alert, id: deps.newId(), userId, createdAt: now });
    queued += 1;
  };
  for (const notice of deps.sources.notices(since)) add(notice.userId, noticeAlert(notice));
  for (const event of deps.sources.events(since)) {
    const alert = ALERTED_ACTIONS_FOR_ADMINS.has(event.action) ? eventAlert(event) : null;
    if (!alert) continue;
    for (const userId of new Set([...admins, ...(event.ownerId ? [event.ownerId] : [])])) add(userId, alert);
  }
  for (const call of deps.sources.calls(now, until)) add(call.hostId, callAlert({ id: call.id, who: call.who, when: deps.timeOf(call.startsAt) }));
  return queued;
}

/** Sends what's waiting. A device that's gone is forgotten. */
export async function sendAlerts(deps: PushDeps, send: Sender): Promise<{ readonly sent: number; readonly held: number; readonly dropped: number }> {
  let sent = 0;
  let held = 0;
  let dropped = 0;
  for (const alert of deps.queue.waiting(200)) {
    const decision = alertDecision(alert.createdAt, deps.clock(), deps.quietNow(alert.userId));
    if (decision === "drop") {
      deps.queue.dropped(alert.id, deps.clock());
      dropped += 1;
      continue;
    }
    if (decision === "hold") {
      held += 1;
      continue;
    }
    for (const device of deps.devices.forUser(alert.userId)) {
      const outcome = await send(device, { title: alert.title, body: alert.body, url: alert.url, tag: alert.key });
      if (outcome === "sent") deps.devices.sent(device.id, deps.clock());
      else if (outcome === "gone") deps.devices.removeEndpoint(device.endpoint);
      else deps.devices.failed(device.id);
    }
    deps.queue.sent(alert.id, deps.clock());
    sent += 1;
  }
  return { sent, held, dropped };
}
