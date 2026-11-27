// The search read model. One statement per kind of record. Every word must
// appear somewhere in the record. Words are passed as values, and their own
// % and _ are matched as written.
import type { SearchHit, SearchKind, SearchReader } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";

const like = (word: string) => `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** For each kind: the text to search, what to show, and where it opens. */
const KINDS: Readonly<Record<SearchKind, { readonly from: string; readonly haystack: string; readonly name: string; readonly context: string; readonly extra: string; readonly href: string; readonly order: string }>> = {
  clients: { from: "client_organization c", haystack: "c.name", name: "c.name", context: "''", extra: "c.status", href: "'/clients/' || c.id", order: "c.name" },
  contacts: {
    from: "contact k join client_organization c on c.id = k.organization_id",
    haystack: "k.name || ' ' || coalesce(k.email, '') || ' ' || coalesce(k.phone, '') || ' ' || coalesce(k.title, '')",
    name: "k.name",
    context: "c.name",
    extra: "coalesce(k.email, k.phone, '')",
    href: "'/clients/' || c.id || '#contacts'",
    order: "k.name",
  },
  opportunities: { from: "opportunity o join client_organization c on c.id = o.organization_id", haystack: "o.title || ' ' || c.name", name: "o.title", context: "c.name", extra: "o.stage", href: "'/opportunities/' || o.id", order: "o.title" },
  projects: { from: "project p left join client_organization c on c.id = p.organization_id", haystack: "p.name || ' ' || coalesce(c.name, 'Company work')", name: "p.name", context: "coalesce(c.name, 'Company work')", extra: "p.status", href: "'/projects/' || p.id", order: "p.name" },
  tasks: { from: "task t join project p on p.id = t.project_id", haystack: "t.title || ' ' || t.description", name: "t.title", context: "p.name", extra: "t.status", href: "'/tasks/' || t.id", order: "t.title" },
  proposals: {
    from: "proposal r join opportunity o on o.id = r.opportunity_id join client_organization c on c.id = o.organization_id",
    haystack: "r.title || ' ' || c.name",
    name: "r.title",
    context: "c.name",
    extra: "r.status",
    href: "'/proposals/' || r.id",
    order: "r.title",
  },
  invoices: {
    from: "invoice i left join project p on p.id = i.project_id join client_organization c on c.id = i.organization_id",
    haystack: "'inv-' || printf('%04d', i.number) || ' ' || c.name || ' ' || coalesce(p.name, '') || ' ' || i.lines",
    name: "'INV-' || printf('%04d', i.number)",
    context: "c.name || coalesce(', ' || p.name, '')",
    extra: "i.status",
    href: "'/invoices/' || i.id",
    order: "i.number desc",
  },
  articles: { from: "article a", haystack: "a.title || ' ' || a.category || ' ' || a.tags || ' ' || a.body", name: "a.title", context: "a.category", extra: "a.kind", href: "'/knowledge/' || a.slug", order: "a.title" },
};

export function sqliteSearchReader(db: Database): SearchReader {
  const statements = new Map<string, ReturnType<Database["prepare"]>>();
  // Statements are built from the fixed table above and a count of words, never from the words themselves.
  const statement = (kind: SearchKind, count: number) => {
    const key = `${kind}:${count}`;
    let made = statements.get(key);
    if (!made) {
      const k = KINDS[kind];
      const where = Array.from({ length: count }, () => `(${k.haystack}) like ? escape '\\' collate nocase`).join(" and ");
      const archived = kind === "articles" ? " and a.status = 'current'" : "";
      const alias = k.from.split(" ")[1];
      // The best matches first, before the limit: the name starting with what was typed,
      // then a word in the name starting with it, then anywhere. Then by name.
      const best = `case when (${k.name}) like ? escape '\\' collate nocase then 0 when (${k.name}) like ? escape '\\' collate nocase then 1 else 2 end`;
      const order = kind === "invoices" ? k.order : `${best}, ${k.order} collate nocase`;
      made = db.prepare(`select ${k.name} as name, ${k.context} as context, ${k.extra} as extra, ${k.href} as href, ${alias}.id as id from ${k.from} where ${where}${archived} order by ${order} limit ?`);
      statements.set(key, made);
    }
    return made;
  };
  const byNumber = db.prepare(
    `select 'INV-' || printf('%04d', i.number) as name, c.name || coalesce(', ' || p.name, '') as context, i.status as extra, '/invoices/' || i.id as href, i.id as id
       from invoice i left join project p on p.id = i.project_id join client_organization c on c.id = i.organization_id where i.number = ?`,
  );
  const toHit = (row: Record<string, unknown>): SearchHit => ({ id: String(row["id"]), name: String(row["name"]), context: String(row["context"] ?? ""), extra: String(row["extra"] ?? ""), href: String(row["href"]) });
  return {
    find(kind, words, limit) {
      if (words.length === 0) return [];
      const typed = words.join(" ").replace(/[\\%_]/g, (c) => `\\${c}`);
      const first = (words[0] ?? "").replace(/[\\%_]/g, (c) => `\\${c}`);
      const ranking = kind === "invoices" ? [] : [`${typed}%`, `% ${first}%`];
      return statement(kind, words.length)
        .all(...words.map(like), ...ranking, limit)
        .map((row) => toHit(row as Record<string, unknown>));
    },
    invoiceByNumber(number) {
      const row = byNumber.get(number);
      return row ? toHit(row as Record<string, unknown>) : null;
    },
  };
}
