// Webhooks' forms, for admins. Adding one, or making a new secret, answers
// with the secret, once: never a redirect that would put it in an address bar.
import { Hono } from "hono";
import { addWebhook, changeWebhook, removeWebhook, replaceWebhookSecret, setWebhookPaused, testWebhook, type WebhooksDeps } from "../application/webhooks.ts";
import { formPosts, parseId, readForm, withMessage, type FormFields, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That webhook doesn’t exist.",
  unchanged: "Nothing changed.",
  "not-ready": "HQ has no key to sign webhooks with. Set HQ_NOTICE_SECRET on the server.",
  "address-invalid": "Enter an https address on the usual port, with no username or password in it.",
  "address-private": "That address is inside a network. Use one on the public internet, like your n8n's.",
  "events-missing": "Tick at least one thing to send.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

/** The ticked events: each is a checkbox named event-<name>. */
const ticked = (f: FormFields): string[] =>
  Object.keys(f)
    .filter((name) => name.startsWith("event-") && f[name] === "1")
    .map((name) => name.slice("event-".length));

type Deps = {
  readonly webhooks: WebhooksDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
  readonly secretPage: (view: { readonly id: string; readonly url: string; readonly secret: string; readonly fresh: boolean }) => string;
};

const once = (html: string) => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });

export function webhookRoutes(deps: Deps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/webhooks" });
  const back = (to: string, code: string) => deps.sign(withMessage(to, "problem", messageFor(code)));

  app.post("/webhooks", async (c) => {
    const { fields } = await readForm(c);
    const made = addWebhook(deps.webhooks, deps.actorOf(c.req.header("cookie") ?? ""), { url: fields["url"] ?? "", events: ticked(fields) });
    if (!made.ok) return c.redirect(back("/webhooks", made.error), 303);
    return once(deps.secretPage({ id: made.value.webhook.id, url: made.value.webhook.url, secret: made.value.secret, fresh: false }));
  });
  app.post("/webhooks/:id/secret", async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id.ok) return c.redirect(back("/webhooks", "not-found"), 303);
    const made = replaceWebhookSecret(deps.webhooks, deps.actorOf(c.req.header("cookie") ?? ""), id.value);
    if (!made.ok) return c.redirect(back(`/webhooks/${id.value}`, made.error), 303);
    return once(deps.secretPage({ id: made.value.webhook.id, url: made.value.webhook.url, secret: made.value.secret, fresh: true }));
  });
  const here = (_v: unknown, id: Id | null) => `/webhooks/${id ?? ""}`;
  post("/webhooks/:id", (actor, f, id) => changeWebhook(deps.webhooks, actor, id as Id, { url: f["url"] ?? "", events: ticked(f) }), { done: here, back: (id) => `/webhooks/${id ?? ""}`, message: "Webhook saved." });
  post("/webhooks/:id/pause", (actor, f, id) => setWebhookPaused(deps.webhooks, actor, id as Id, f["paused"] === "1"), {
    done: here,
    back: (id) => `/webhooks/${id ?? ""}`,
    message: (hook) => (hook.paused ? "Paused. Nothing new is queued, and what's waiting waits." : "Resumed. What was waiting goes with the next run."),
  });
  post("/webhooks/:id/test", (actor, _f, id) => testWebhook(deps.webhooks, actor, id as Id), { done: here, back: (id) => `/webhooks/${id ?? ""}`, message: "A test is queued. It goes within a minute." });
  post("/webhooks/:id/remove", (actor, _f, id) => removeWebhook(deps.webhooks, actor, id as Id), { done: () => "/webhooks", back: (id) => `/webhooks/${id ?? ""}`, message: "Webhook deleted, with its deliveries." });
  return app;
}
