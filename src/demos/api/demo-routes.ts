// Demos' forms, sending them, and the short address a demo link opens
// (decision 0013, section 8).
import { Hono } from "hono";
import { addDemo, editDemo, openDemoLink, prepareDemoEmail, recordDemosSent, removeDemo, type DemosDeps } from "../application/demos.ts";
import { formPosts, type FormFields, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "name-missing": "Name the demo, like Counter.",
  "name-too-long": "Keep the name under 80 characters.",
  "url-invalid": "Enter the demo’s https address, like https://counter.potomac.solutions.",
  "description-too-long": "Keep what it is under 300 characters.",
  "sign-in-too-long": "Keep the sign-in under 500 characters.",
  "in-use": "That demo has been sent, so it stays. Turn it off instead.",
  "no-demos": "Tick at least one demo to send.",
  "no-email": "Nobody on this opportunity has an email. Add one to its contact first.",
  "note-too-long": "Keep your note under 1,000 characters.",
  "email-off": "Email isn’t set up, so demos can’t be sent yet.",
  "send-failed": "The email couldn’t be sent. Nothing was recorded; try again.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";
const input = (f: FormFields) => ({ name: f["name"] ?? "", url: f["url"] ?? "", description: f["description"] ?? null, signIn: f["signIn"] ?? null });

export function demoRoutes(deps: { readonly demos: DemosDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string; readonly publicUrl: string; readonly mail: ((message: { readonly to: string; readonly subject: string; readonly body: string }) => Promise<boolean>) | null }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/demos" });
  post("/demos", (actor, f) => addDemo(deps.demos, actor, input(f)), { done: () => "/demos", back: () => "/demos#add", message: "Added." });
  post("/demos/:id", (actor, f, id) => editDemo(deps.demos, actor, id as Id, { ...input(f), active: f["active"] === "1" }), { done: () => "/demos", back: () => "/demos", message: "Saved." });
  post("/demos/:id/remove", (actor, _f, id) => removeDemo(deps.demos, actor, id as Id), { done: () => "/demos", back: () => "/demos", message: "Removed." });
  post(
    "/opportunities/:id/demos",
    async (actor, f, id) => {
      const demoIds = Object.keys(f).filter((key) => key.startsWith("demo-") && f[key] === "1").map((key) => key.slice(5) as Id);
      const made = prepareDemoEmail(deps.demos, actor, id as Id, { demoIds, note: f["note"] ?? "" }, deps.publicUrl);
      if (!made.ok) return made;
      if (!deps.mail) return { ok: false as const, error: "email-off" };
      const sent = await deps.mail({ to: made.value.to.email, subject: made.value.subject, body: made.value.body }).catch(() => false);
      if (!sent) return { ok: false as const, error: "send-failed" };
      recordDemosSent(deps.demos, actor as Id, id as Id, made.value.links);
      return { ok: true as const, value: { to: made.value.to.email, count: made.value.links.length } };
    },
    { done: (_v, id) => `/opportunities/${id}#demos`, back: (id) => `/opportunities/${id}#demos`, message: (sent) => `Sent ${sent.count} ${sent.count === 1 ? "demo" : "demos"} to ${sent.to}. You’ll see here when they’re opened.` },
  );
  return app;
}

/** GET /d/<code>: counts the open and sends them to the demo. */
export function demoLinkRoutes(deps: { readonly demos: DemosDeps }): Hono {
  const app = new Hono();
  app.get("/d/:code", (c) => {
    const to = openDemoLink(deps.demos, c.req.param("code"), c.req.method === "HEAD" ? "" : (c.req.header("user-agent") ?? ""));
    if (!to) return new Response("This link isn’t in use.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    return new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  });
  return app;
}
