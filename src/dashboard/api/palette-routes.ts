// The command palette's answers (Ctrl+K, decision 0014): what search finds
// for the words typed, and for an opportunity it finds, the stage moves the
// signed-in person may make. Read-only; a move is posted as an ordinary form.
import { Hono } from "hono";
import type { Id } from "../../shared/index.ts";
import type { SearchView } from "../application/search.ts";

export type PaletteMove = { readonly label: string; readonly action: string; readonly fields: Readonly<Record<string, string>> };

export type PaletteDeps = {
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly search: (actorId: Id, q: string) => SearchView;
  /** The moves for one opportunity: on to its next stage, or back one. Empty when they may not move it. */
  readonly moves: (actorId: Id, opportunityId: Id, title: string) => readonly PaletteMove[];
};

const OPPORTUNITY = /^\/opportunities\/([0-9a-f-]{36})$/;

export function paletteRoutes(deps: PaletteDeps): Hono {
  const app = new Hono();
  app.get("/palette.json", (c) => {
    c.header("cache-control", "no-store");
    const actor = deps.actorOf(c.req.header("cookie") ?? "");
    if (!actor) return c.json({ hits: [], moves: [] }, 401);
    const q = (c.req.query("q") ?? "").slice(0, 100);
    const view = deps.search(actor, q);
    const hits = view.groups.flatMap((group) => group.hits.map((hit) => ({ kind: group.label, label: hit.name, context: hit.context, href: hit.href })));
    const moves = hits.flatMap((hit) => {
      const id = OPPORTUNITY.exec(hit.href)?.[1];
      return id ? deps.moves(actor, id as Id, hit.label) : [];
    });
    return c.json({ hits: hits.slice(0, 12), moves: moves.slice(0, 6) });
  });
  return app;
}
