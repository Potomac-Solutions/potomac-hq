// Phone alerts' forms (quality of life, 2026-11-25): a device turning alerts
// on (posted by its own browser), removing one, and a test alert.
import { Hono } from "hono";
import { deviceLabel } from "../domain/push.ts";
import { addDevice, removeDevice, testAlert, type PushDeps } from "../application/push.ts";
import { formPosts, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That device isn’t one of yours.",
  "not-set-up": "Alerts need HQ_VAPID_PUBLIC_KEY and HQ_VAPID_PRIVATE_KEY on the server first.",
  "invalid-device": "This browser didn’t give HQ what it needs for alerts. Try again, or another browser.",
  "no-devices": "Turn on alerts on a device first.",
};

export function pushRoutes(deps: { readonly push: PushDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor: (code) => MESSAGES[code] ?? "That didn’t work. Try again.", home: "/settings#alerts" });
  const back = () => "/settings#alerts";
  post("/push/devices", (actor, f) => addDevice(deps.push, actor, { endpoint: f["endpoint"] ?? "", p256dh: f["p256dh"] ?? "", auth: f["auth"] ?? "", label: deviceLabel((f["ua"] ?? "").slice(0, 300)) }), { done: back, back, message: "Alerts are on for this device." });
  post("/push/devices/:id/remove", (actor, _f, id) => removeDevice(deps.push, actor, id as Id), { done: back, back, message: "That device won’t get alerts." });
  post("/push/test", (actor) => testAlert(deps.push, actor), { done: back, back, message: "A test alert is on its way. It can take a minute." });
  return app;
}
