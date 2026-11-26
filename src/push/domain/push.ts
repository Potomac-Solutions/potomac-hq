// Phone alerts (quality of life, 2026-11-25): what is pushed to a person's
// phone, and when. A device is added by its own browser; an alert waits in a
// queue until it can go (not in quiet hours), and is dropped rather than sent
// once it's 12 hours old.
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type Device = { readonly endpoint: string; readonly p256dh: string; readonly auth: string; readonly label: string };
export type DeviceError = "invalid-device";

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Reads what the browser's push subscription gave: an https endpoint and its two keys. */
export function readDevice(input: { readonly endpoint: string; readonly p256dh: string; readonly auth: string; readonly label: string }): Result<Device, DeviceError> {
  const endpoint = input.endpoint.trim();
  const p256dh = input.p256dh.trim();
  const auth = input.auth.trim();
  let url: URL | null = null;
  try {
    url = new URL(endpoint);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:" || endpoint.length > 1000) return err("invalid-device");
  if (!B64URL.test(p256dh) || p256dh.length < 40 || p256dh.length > 200 || !B64URL.test(auth) || auth.length < 10 || auth.length > 100) return err("invalid-device");
  return ok({ endpoint, p256dh, auth, label: input.label.replace(/\s+/g, " ").trim().slice(0, 100) });
}

/** A device's name from its browser's description: "Phone (Android, Chrome)". */
export function deviceLabel(userAgent: string): string {
  const os = /iPhone|iPad/.test(userAgent) ? "iPhone" : /Android/.test(userAgent) ? "Android" : /Mac OS X/.test(userAgent) ? "Mac" : /Windows/.test(userAgent) ? "Windows" : /Linux/.test(userAgent) ? "Linux" : "Device";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "a browser";
  return `${os}, ${browser}`;
}

export type Alert = { readonly key: string; readonly title: string; readonly body: string; readonly url: string };

/** The longest an alert waits before it's dropped. */
export const MAX_WAIT_HOURS = 12;

/** Whether a waiting alert goes now, waits (quiet hours), or is dropped (too old to be news). */
export function alertDecision(createdAt: string, now: string, quiet: boolean): "send" | "hold" | "drop" {
  if (Date.parse(now) - Date.parse(createdAt) > MAX_WAIT_HOURS * 3_600_000) return "drop";
  return quiet ? "hold" : "send";
}

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text);

/** What a notice says on a phone. */
export function noticeAlert(notice: { readonly id: string; readonly kind: string; readonly actorName: string; readonly taskTitle: string; readonly detail: string }): Alert {
  const who = notice.actorName || "Someone";
  const title = notice.kind === "assigned" ? `${who} gave you “${notice.taskTitle}”` : notice.kind === "mentioned" ? `${who} mentioned you` : `Reminder: ${notice.taskTitle}`;
  return { key: `notice:${notice.id}`, title: cut(title, 120), body: cut(notice.kind === "mentioned" ? `On “${notice.taskTitle}”: ${notice.detail}` : notice.detail, 300), url: `/notices/${notice.id}` };
}

/** What a client's message, a call request or a site going down says on a phone. Null for anything else. */
export function eventAlert(event: { readonly id: string; readonly action: string; readonly recordId: string; readonly name: string }): Alert | null {
  if (event.action === "site.down") return { key: `event:${event.id}`, title: cut(`Site down: ${event.name}`, 120), body: "HQ's monitor couldn't reach it.", url: "/sites" };
  if (event.action === "project.message-received") return { key: `event:${event.id}`, title: cut(`New message on ${event.name}`, 120), body: "A client wrote in the portal.", url: `/projects/${event.recordId}#updates` };
  if (event.action === "call.requested") return { key: `event:${event.id}`, title: cut(`${event.name} asked for a call`, 120), body: "From the client portal.", url: "/calls" };
  return null;
}

/** A booked call about to start. */
export function callAlert(call: { readonly id: string; readonly who: string; readonly when: string }): Alert {
  return { key: `call:${call.id}`, title: cut(`Call at ${call.when} with ${call.who}`, 120), body: "Tap to get ready.", url: `/get-ready/${call.id}` };
}
