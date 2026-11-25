// Automations' forms, and the secret address n8n posts to at the end of a
// run (decision 0010, section 5).
import { Hono } from "hono";
import { addAutomation, checkIn, editAutomation, newAutomationSecret, removeAutomation, secretAddress, type AutomationsDeps } from "../application/automations.ts";
import { formPosts, parseId, readForm, withMessage, type FormFields, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "name-missing": "Name the automation, like Orders to the sheet.",
  "name-too-long": "Keep the name under 80 characters.",
  "description-too-long": "Keep what it does under 500 characters.",
  "url-invalid": "The n8n link must be an https address, or empty.",
  "invalid-schedule": "Choose how often it runs from the list.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";
const once = (html: string) => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
const input = (f: FormFields) => ({ name: f["name"] ?? "", description: f["description"] ?? null, n8nUrl: f["n8nUrl"] ?? null, every: f["every"] ?? "" });

export function automationRoutes(deps: { readonly automations: AutomationsDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string; readonly publicUrl: string; readonly secretPage: (view: { readonly name: string; readonly organizationId: string; readonly address: string; readonly fresh: boolean }) => string }): Hono {
  const app = new Hono();
  const back = (to: string, code: string) => deps.sign(withMessage(to, "problem", messageFor(code)));
  const clientPage = (id: string) => `/clients/${id}#automations`;

  // The secret address is shown once, on the answer: never a redirect that would put it in an address bar.
  app.post("/clients/:id/automations", async (c) => {
    const org = parseId(c.req.param("id"));
    if (!org.ok) return c.redirect(back("/automations", "not-found"), 303);
    const { fields } = await readForm(c);
    const made = addAutomation(deps.automations, deps.actorOf(c.req.header("cookie") ?? ""), org.value, input(fields));
    if (!made.ok) return c.redirect(back(clientPage(org.value), made.error), 303);
    return once(deps.secretPage({ name: made.value.automation.name, organizationId: org.value, address: secretAddress(deps.publicUrl, made.value.token), fresh: false }));
  });
  app.post("/automations/:id/secret", async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id.ok) return c.redirect(back("/automations", "not-found"), 303);
    const made = newAutomationSecret(deps.automations, deps.actorOf(c.req.header("cookie") ?? ""), id.value);
    if (!made.ok) return c.redirect(back("/automations", made.error), 303);
    return once(deps.secretPage({ name: made.value.automation.name, organizationId: made.value.automation.organizationId, address: secretAddress(deps.publicUrl, made.value.token), fresh: true }));
  });

  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/automations" });
  post("/automations/:id", (actor, f, id) => editAutomation(deps.automations, actor, id as Id, { ...input(f), active: f["active"] === "1" }), {
    done: (one) => clientPage(one.organizationId),
    back: () => "/automations",
    message: "Saved.",
  });
  post("/automations/:id/remove", (actor, _f, id) => removeAutomation(deps.automations, actor, id as Id), {
    done: (one) => clientPage(one.organizationId),
    back: () => "/automations",
    message: "Removed. Its address no longer works.",
  });
  return app;
}

/**
 * POST /hooks/automations/<token>: n8n checking in. `status` is ok or failed
 * (in the query, a form or JSON), with an optional `message`. No cookie and
 * no Origin: the token is the only key.
 */
export function automationHookRoutes(deps: { readonly automations: AutomationsDeps; readonly allow: (incoming: Request) => boolean }): Hono {
  const app = new Hono();
  const plain = (text: string, status: 200 | 400 | 404 | 413 | 429) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  app.post("/hooks/automations/:token", async (c) => {
    if (!deps.allow(c.req.raw)) return plain("Too many check-ins.", 429);
    const length = Number(c.req.header("content-length") ?? "0");
    if (!(length >= 0 && length <= 8000)) return plain("Too much.", 413);
    let status = c.req.query("status") ?? "";
    let message = c.req.query("message") ?? "";
    const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    try {
      if (type === "application/json" && length > 0) {
        const body = (await c.req.json()) as Record<string, unknown>;
        if (typeof body["status"] === "string") status = body["status"];
        if (typeof body["message"] === "string") message = body["message"];
      } else if ((type === "application/x-www-form-urlencoded" || type === "multipart/form-data") && length > 0) {
        const { fields } = await readForm(c);
        status = fields["status"] ?? status;
        message = fields["message"] ?? message;
      }
    } catch {
      return plain("That body couldn’t be read.", 400);
    }
    const done = checkIn(deps.automations, c.req.param("token"), status.trim().toLowerCase(), message);
    if (!done.ok) return done.error === "invalid-status" ? plain("status must be ok or failed.", 400) : plain("Not found.", 404);
    return plain(`Thanks. ${done.value.state === "ok" ? "Running fine." : "Marked as failed."}`, 200);
  });
  return app;
}
