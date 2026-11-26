// Finding your way (decision 0015, follow-up): pinning the page you're on,
// and what the command bar reads as you type.
import { Hono } from "hono";
import { togglePin, type PinsDeps } from "../application/pins.ts";
import type { SearchView } from "../application/search.ts";
import { formPosts, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-pinnable": "That page can’t be pinned.",
  "too-many-pins": "You have 12 pins. Unpin one first.",
};

/** Back to the page that was pinned: one of HQ's own, never another site. */
const backTo = (href: string): string => (href.startsWith("/") && !href.startsWith("//") && !href.includes("\\") && href.length < 300 ? href : "/");

export function navRoutes(deps: { readonly pins: PinsDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor: (code) => MESSAGES[code] ?? "That didn’t work. Try again.", home: "/" });
  post("/nav/pin", (actor, f) => togglePin(deps.pins, actor, f["href"] ?? ""), { done: (_v, _id, f) => backTo(f["href"] ?? "/"), back: (_id, f) => backTo(f["href"] ?? "/"), message: (on) => (on ? "Pinned to your sidebar." : "Unpinned.") });
  return app;
}

const ONE: Readonly<Record<string, string>> = { Clients: "Client", Contacts: "Contact", Opportunities: "Deal", Projects: "Project", Tasks: "Task", Proposals: "Proposal", Invoices: "Invoice", "Knowledge base": "Article" };

/** A stage move the command bar can post for a deal it found (decision 0014, folded into the command bar). */
export type FindMove = { readonly label: string; readonly action: string; readonly fields: Readonly<Record<string, string>> };

const OPPORTUNITY = /^\/opportunities\/([0-9a-f-]{36})$/;

/** The command bar's results as you type: stage moves for deals it finds, then pages, then records, for this person only. */
export function findRoutes(deps: {
  readonly find: (actorId: Id | null, q: string) => SearchView;
  readonly actorOf: (cookieHeader: string) => Id | null;
  /** The moves for one deal: on to its next stage, or back one. Empty when they may not move it. */
  readonly moves?: (actorId: Id, opportunityId: Id, title: string) => readonly FindMove[];
}): Hono {
  const app = new Hono();
  app.get("/find.json", (c) => {
    const actor = deps.actorOf(c.req.header("cookie") ?? "");
    const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
    if (actor === null) return new Response(JSON.stringify({ items: [], moves: [] }), { status: 401, headers });
    const view = deps.find(actor, c.req.query("q") ?? "");
    const items = [
      ...view.pages.map((page) => ({ kind: "Page", label: page.label, detail: page.what, href: page.href })),
      ...view.groups.flatMap((group) => group.hits.map((hit) => ({ kind: ONE[group.label] ?? group.label, label: hit.name, detail: hit.context, href: hit.href }))),
    ].slice(0, 12);
    const moves = deps.moves
      ? items.flatMap((item) => {
          const id = OPPORTUNITY.exec(item.href)?.[1];
          return id && deps.moves ? deps.moves(actor, id as Id, item.label) : [];
        }).slice(0, 4)
      : [];
    return new Response(JSON.stringify({ items, moves }), { status: 200, headers });
  });
  return app;
}
