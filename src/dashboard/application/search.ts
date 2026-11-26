// Search from the top bar (after 0.10.0). One box that finds clients,
// contacts, opportunities, projects, tasks, proposals, invoices and
// knowledge base articles. Each kind is searched only for someone who may
// see it, and a kind they may not see is never mentioned.
//
// Reading changes nothing, so it writes no activity event.
import { PER_KIND, rank, searchWords } from "../domain/search.ts";
import { matchPlaces, type Place } from "../domain/places.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import type { Id } from "../../shared/index.ts";
import type { SearchHit, SearchKind, SearchReader } from "./ports.ts";

export type SearchDeps = { readonly users: IdentityUserStore; readonly search: SearchReader };

const KINDS: readonly { readonly kind: SearchKind; readonly label: string; readonly permission: string }[] = [
  { kind: "clients", label: "Clients", permission: "client.view" },
  { kind: "contacts", label: "Contacts", permission: "client.view" },
  { kind: "opportunities", label: "Opportunities", permission: "opportunity.view" },
  { kind: "projects", label: "Projects", permission: "project.view" },
  { kind: "tasks", label: "Tasks", permission: "task.view" },
  { kind: "proposals", label: "Proposals", permission: "proposal.view" },
  { kind: "invoices", label: "Invoices", permission: "invoice.view" },
  { kind: "articles", label: "Knowledge base", permission: "knowledge.view" },
];

/** What a record's status looks like next to its name. Statuses that need no mention are left out. */
const EXTRA: Readonly<Record<string, string>> = {
  former: "Former client",
  won: "Won",
  lost: "Lost",
  completed: "Finished",
  cancelled: "Cancelled",
  "on-hold": "On hold",
  done: "Done",
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  void: "Void",
  accepted: "Accepted",
  declined: "Declined",
  revised: "Revised",
  decision: "Decision",
};

export type SearchView = {
  readonly q: string;
  readonly searched: boolean;
  /** Pages in HQ that do what was typed (decision 0015), best first. */
  readonly pages: readonly { readonly key: string; readonly label: string; readonly href: string; readonly what: string }[];
  readonly total: number;
  readonly groups: readonly { readonly kind: string; readonly label: string; readonly more: boolean; readonly hits: readonly { readonly key: string; readonly name: string; readonly context: string; readonly extra: string; readonly href: string }[] }[];
  /** Where to look when nothing was found. */
  readonly tips: readonly string[];
};

/** `places` are the pages this person may open, so search can offer them too. */
export function search(deps: SearchDeps, actorId: Id | null, raw: string, places: readonly Place[] = []): SearchView {
  const query = searchWords(raw);
  if (actorId === null || query.words.length === 0) return { q: query.text, searched: false, pages: [], total: 0, groups: [], tips: [] };
  const pages = matchPlaces(places, query.text).map((place) => ({ key: place.key, label: place.label, href: place.href, what: place.what }));
  const allowed = KINDS.filter((kind) => authorize(deps, actorId, kind.permission).ok);
  const groups = allowed.flatMap((kind) => {
    let hits: SearchHit[] = deps.search.find(kind.kind, query.words, PER_KIND + 1);
    if (kind.kind === "invoices" && query.invoiceNumber !== null) {
      const exact = deps.search.invoiceByNumber(query.invoiceNumber);
      if (exact) hits = [exact, ...hits.filter((hit) => hit.id !== exact.id)];
    }
    if (hits.length === 0) return [];
    const sorted = kind.kind === "invoices" ? hits : [...hits].sort((a, b) => rank(a.name, query.words) - rank(b.name, query.words));
    return [
      {
        kind: kind.kind,
        label: kind.label,
        more: hits.length > PER_KIND,
        hits: sorted.slice(0, PER_KIND).map((hit) => ({ key: `${kind.kind}-${hit.id}`, name: hit.name, context: hit.context, extra: kind.kind === "contacts" ? hit.extra : (EXTRA[hit.extra] ?? ""), href: hit.href })),
      },
    ];
  });
  const total = groups.reduce((sum, group) => sum + group.hits.length, 0) + pages.length;
  return {
    q: query.text,
    searched: true,
    pages,
    total,
    groups,
    tips: total > 0 ? [] : ["Check the spelling, or use fewer words.", "Search finds names and titles, contacts' emails and phone numbers, invoice numbers like INV-0003, and the text of tasks and articles."],
  };
}
