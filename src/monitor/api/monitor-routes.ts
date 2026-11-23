// Site monitoring's forms: watch a client's site, stop watching one.
import { Hono } from "hono";
import { addSite, stopWatching, type MonitorDeps } from "../application/monitor.ts";
import { formPosts, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "url-invalid": "Enter the site’s address, like feedstore.com or https://feedstore.com.",
  "url-not-public": "That address isn’t on the public internet, so HQ won’t check it.",
  "already-watched": "That site is already watched.",
  "too-many": "HQ watches up to 200 sites.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

export function monitorRoutes(deps: { readonly monitor: MonitorDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/sites" });
  post("/clients/:id/sites", (actor, f, id) => addSite(deps.monitor, actor, id as Id, f["url"] ?? ""), {
    done: (_, id) => `/clients/${id}#sites`,
    back: (id) => `/clients/${id}#sites`,
    message: "Watching it. The first check is within five minutes.",
  });
  post("/sites/:id/stop", (actor, _f, id) => stopWatching(deps.monitor, actor, id as Id), {
    done: (site) => `/clients/${site.organizationId}#sites`,
    back: () => "/sites",
    message: "No longer watched.",
  });
  return app;
}
