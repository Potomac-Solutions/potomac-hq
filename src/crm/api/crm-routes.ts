// The CRM's form posts. Each one calls an application service, then sends the
// browser back to a page with a one-line message (post, redirect, get).
import { Hono } from "hono";
import * as crm from "../application/commands.ts";
import { parseId, withUndo, type Id } from "../../shared/index.ts";
import { messageFor } from "./messages.ts";

export type CrmRoutesDeps = {
  readonly crm: crm.CrmDeps;
  /** Moves everything of one client onto another, for merging duplicates. */
  readonly merge?: crm.ClientMerger;
  /** The signed-in HQ user's id, or null. */
  readonly actorOf: (cookieHeader: string) => Id | null;
  /** Signs the one-line message in a location. */
  readonly sign: (location: string) => string;
};

type Answer<V = { id: string }> = { ok: true; value: V } | { ok: false; error: string };

const STAGE_NAMES: Readonly<Record<string, string>> = { new: "New", "consult-booked": "Consult booked", consulted: "Consulted", quoted: "Quoted", won: "Won", lost: "Lost" };
const ORDER = ["new", "consult-booked", "consulted", "quoted", "won"];

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** "Moved to Quoted.", "Moved back to New.", "Reopened at Quoted." */
function stageMessage(from: string, to: string): string {
  const name = STAGE_NAMES[to] ?? to;
  if (from === "won" || from === "lost") return to === "lost" ? `Marked lost.` : `Reopened at ${name}.`;
  if (to === "lost") return "Marked lost.";
  if (to === "won") return "Marked won.";
  return ORDER.indexOf(to) < ORDER.indexOf(from) ? `Moved back to ${name}.` : `Moved to ${name}.`;
}

export function crmRoutes(deps: CrmRoutesDeps): Hono {
  const app = new Hono();

  /** Reads the form, runs the service, and answers 303 to `done` or back to `back`. */
  const post = <V extends { id: string }>(
    path: string,
    run: (actor: Id | null, form: Record<string, string>, id: Id | null) => Answer<V>,
    places: { done: (value: V, id: Id | null) => string; back: (id: Id | null) => string; message: string; undo?: (value: V, id: Id | null) => { action: string; fields: Record<string, string>; label?: string } | null },
  ) =>
    app.post(path, async (c) => {
      const raw = await c.req.parseBody();
      const form: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw)) if (typeof value === "string") form[key] = value;
      const param = c.req.param("id");
      const parsed = param === undefined ? null : parseId(param);
      const id = parsed === null ? null : parsed.ok ? parsed.value : null;
      if (param !== undefined && id === null) return c.redirect(deps.sign(`/clients?problem=${encodeURIComponent(messageFor("not-found"))}`), 303);

      const answer = run(deps.actorOf(c.req.header("cookie") ?? ""), form, id);
      const to = answer.ok
        ? withUndo(`${places.done(answer.value, id)}?done=${encodeURIComponent(places.message)}`, places.undo?.(answer.value, id))
        : `${answer.error === "not-found" ? "/clients" : places.back(id)}?problem=${encodeURIComponent(answer.error.startsWith("duplicate|") ? `${answer.error.slice("duplicate|".length)} ${answer.error.includes(" or ") ? "are" : "is"} already in HQ, and looks like the same business. Open it from the list below, or tick “It’s a different business” and add it again.` : messageFor(answer.error))}`;
      return c.redirect(deps.sign(to), 303);
    });

  // A name that looks like a client already here asks first (quality of life, 2026-11-25).
  post("/clients", (actor, f) => {
    const same = f["different"] === "1" ? [] : crm.possibleDuplicates(deps.crm, actor, f["name"] ?? "");
    if (same.length > 0) return { ok: false as const, error: `duplicate|${same.map((one) => `“${one.name}”`).join(" or ")}` };
    return crm.createClient(deps.crm, actor, { name: f["name"] ?? "", sizeTier: f["sizeTier"] ?? null, website: f["website"] ?? null, phone: f["phone"] ?? null, address: f["address"] ?? null });
  }, {
    done: (client) => `/clients/${client.id}`,
    back: () => "/clients",
    message: "Client added.",
  });

  // Merging a duplicate into the client to keep.
  post("/clients/:id/merge", (actor, f, id) => {
    const into = parseId(f["into"] ?? "");
    if (!deps.merge || !into.ok) return { ok: false as const, error: "not-found" };
    return crm.mergeClients({ ...deps.crm, merge: deps.merge }, actor, id as Id, into.value);
  }, {
    done: (client) => `/clients/${client.id}`,
    back: (id) => `/clients/${id ?? ""}`,
    message: "Merged. Everything from the duplicate is here now.",
  });

  post("/clients/:id/status", (actor, f, id) => crm.setClientStatus(deps.crm, actor, id as Id, f["status"] ?? ""), {
    done: (_, id) => `/clients/${id}`,
    back: (id) => `/clients/${id}`,
    message: "Status changed.",
    undo: (client, id) => ({ label: `${client.name}: status changed`, action: `/clients/${id}/status`, fields: { status: client.from } }),
  });

  post("/clients/:id/demo", (actor, f, id) => crm.setClientDemo(deps.crm, actor, id as Id, f["demo"] === "1"), {
    done: (_, id) => `/clients/${id}`,
    back: (id) => `/clients/${id}`,
    message: "Saved.",
    undo: (client, id) => ({ label: `${client.name}: ${client.demo ? "marked as a demo" : "no longer a demo"}`, action: `/clients/${id}/demo`, fields: client.demo ? {} : { demo: "1" } }),
  });

  post(
    "/clients/:id/contacts",
    (actor, f, id) =>
      crm.addContact(deps.crm, actor, id as Id, { name: f["name"] ?? "", email: f["email"] ?? null, phone: f["phone"] ?? null, title: f["title"] ?? null, isPrimary: f["isPrimary"] === "on" }),
    { done: (_, id) => `/clients/${id}`, back: (id) => `/clients/${id}`, message: "Contact added." },
  );

  post(
    "/clients/:id/billing-contact",
    (actor, f, id) => {
      const set = crm.setBillingContact(deps.crm, actor, id as Id, f["contactId"] ?? "");
      return set.ok ? { ok: true, value: { id: String(id) } } : set;
    },
    { done: (_, id) => `/clients/${id}`, back: (id) => `/clients/${id}`, message: "Saved. Bills, reminders, receipts and statements go to whoever you chose." },
  );

  post(
    "/clients/:id/opportunities",
    (actor, f, id) => {
      const contact = f["contactId"] ? parseId(f["contactId"]) : null;
      return crm.createOpportunity(deps.crm, actor, id as Id, {
        title: f["title"] ?? "",
        leadSource: f["leadSource"] ?? "",
        service: f["service"] ?? null,
        summary: f["summary"] ?? null,
        contactId: contact && contact.ok ? contact.value : null,
      });
    },
    { done: (opportunity) => `/opportunities/${opportunity.id}`, back: (id) => `/clients/${id}`, message: "Opportunity opened." },
  );

  // A stage change from the pipeline goes back to the pipeline. Only that one
  // place is accepted, so the form cannot send the browser anywhere else.
  const stageReturn = (form: Record<string, string>, id: Id | null) => (form["returnTo"] === "pipeline" ? "/pipeline" : `/opportunities/${id}`);
  app.post("/opportunities/:id/stage", async (c) => {
    const raw = await c.req.parseBody();
    const form: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) if (typeof value === "string") form[key] = value;
    const parsed = parseId(c.req.param("id"));
    if (!parsed.ok) return c.redirect(deps.sign(`/clients?problem=${encodeURIComponent(messageFor("not-found"))}`), 303);
    // `back=1` is a person choosing the stage: moving it back, reopening it or undoing (decision 0014). Without it a stage only moves forward.
    const answer = crm.moveOpportunity(deps.crm, deps.actorOf(c.req.header("cookie") ?? ""), parsed.value, { to: form["to"] ?? "", lostReason: form["lostReason"] ?? null, byHand: form["back"] === "1" });
    const place = answer.ok || answer.error !== "not-found" ? stageReturn(form, parsed.value) : "/clients";
    const undo = answer.ok && answer.value.undoable
      ? { label: `${answer.value.title}: ${lowerFirst(stageMessage(answer.value.from, answer.value.stage).replace(/\.$/, ""))}`, action: `/opportunities/${parsed.value}/stage`, fields: { to: answer.value.from, back: "1", ...(answer.value.from === "lost" ? { lostReason: answer.value.fromLostReason } : {}), ...(form["returnTo"] === "pipeline" ? { returnTo: "pipeline" } : {}) } }
      : null;
    const to = answer.ok ? withUndo(`${place}?done=${encodeURIComponent(stageMessage(answer.value.from, answer.value.stage))}`, undo) : `${place}?problem=${encodeURIComponent(messageFor(answer.error))}`;
    return c.redirect(deps.sign(to), 303);
  });

  post("/opportunities/:id/value", (actor, f, id) => crm.setOpportunityValue(deps.crm, actor, id as Id, { pricing: f["pricing"] ?? "", amount: f["amount"] ?? "" }), {
    done: (_, id) => `/opportunities/${id}`,
    back: (id) => `/opportunities/${id}`,
    message: "Price saved.",
    // A price can be changed but not cleared, so a first price has nothing to go back to.
    undo: (o, id) => (o.previous.pricing && o.previous.value ? { label: `${o.title}: price changed`, action: `/opportunities/${id}/value`, fields: { pricing: o.previous.pricing, amount: (o.previous.value.minor / 100).toFixed(2) } } : null),
  });

  post("/opportunities/:id/follow-up", (actor, f, id) => crm.setOpportunityFollowUp(deps.crm, actor, id as Id, f["clear"] === "1" ? null : (f["on"] ?? "")), {
    done: (_, id) => `/opportunities/${id}`,
    back: (id) => `/opportunities/${id}`,
    message: "Follow-up saved.",
    undo: (o, id) => ({ label: `${o.title}: follow-up ${o.followUpOn ? "set" : "cleared"}`, action: `/opportunities/${id}/follow-up`, fields: o.previous.followUpOn ? { on: o.previous.followUpOn } : { clear: "1" } }),
  });

  post("/opportunities/:id/convert", (actor, _f, id) => crm.convertOpportunity(deps.crm, actor, id as Id), {
    done: (project) => `/projects/${project.id}`,
    back: (id) => `/opportunities/${id}`,
    message: "Project started.",
  });

  return app;
}
