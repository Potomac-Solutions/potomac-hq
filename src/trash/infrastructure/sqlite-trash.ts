// The Trash's engine (decision 0023). It finds everything that belongs to a
// record from the schema's own foreign keys, so a table added later goes
// with its owner without a change here, as the client merger does.
//
// What belongs: a row that points at a deleted row through a column that
// can't be empty, or through one that names its owner (a client, project or
// proposal), or that the database itself would delete. A row that only
// mentions a deleted one (a deal "referred by" another client, a call with a
// contact) stays, and that link is cleared, and put back on restore. Notes,
// AI drafts and files point at what they're on by kind and id, with no
// foreign key, and go with it too.
//
// Each delete is one transaction. Foreign keys are checked when it commits,
// so if anything still pointed at a deleted row the whole delete is undone.
import type { Database } from "../../shared/adapters.ts";
import type { TrashKind } from "../domain/trash.ts";
import type { TrashEngine, TrashLine, TrashPlanRow } from "../application/ports.ts";

type Value = string | number | bigint | null | Uint8Array;
type Row = Record<string, Value>;
type Edge = { readonly child: string; readonly column: string; readonly to: string; readonly cascade: boolean };
type Saved = { readonly table: string; readonly row: Row };
type Cleared = { readonly table: string; readonly key: Row; readonly column: string; readonly value: Value };
type Snapshot = { readonly rows: readonly Saved[]; readonly cleared: readonly Cleared[] };

const ROOT_TABLE: Readonly<Record<TrashKind, string>> = { client: "client_organization", contact: "contact", opportunity: "opportunity", proposal: "proposal", project: "project" };
export const rootTable = (kind: TrashKind): string => ROOT_TABLE[kind];

// A column with one of these names says who a row belongs to, even when it may be empty:
// a client's bookings and files, a project's invoices and to-dos.
const OWNER_COLUMNS = new Set(["organization_id", "crm_client_id", "project_id", "proposal_id"]);
// A won deal's project is the deal's, though the column may be empty for company work (0089).
const OWNER_EDGES = new Set(["project.opportunity_id"]);
// Pointers by kind and id: [table, kind column, id column]. A kind is the
// table's name with hyphens ("client-organization"), or one of the extras.
const BY_KIND: readonly (readonly [string, string, string])[] = [
  ["note", "record_type", "record_id"],
  ["ai_draft", "record_type", "record_id"],
  ["file", "owner_type", "owner_id"],
];
const KIND_EXTRAS: Readonly<Record<string, readonly string[]>> = { expense: ["expense-receipt"] };
// Never taken with anything: the audit log is append-only, and AI usage is what was spent.
const KEPT = new Set(["activity_event", "ai_usage", "trash"]);

const ident = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected name in the schema: ${name}`);
  return `"${name}"`;
};

// Rows go through JSON: bytes and big numbers are tagged so they come back as they were.
const encode = (value: Value): unknown => (value instanceof Uint8Array ? { $bytes: Buffer.from(value).toString("base64") } : typeof value === "bigint" ? { $big: value.toString() } : value);
const decode = (value: unknown): Value => {
  if (value && typeof value === "object") {
    const tagged = value as { $bytes?: string; $big?: string };
    if (typeof tagged.$bytes === "string") return new Uint8Array(Buffer.from(tagged.$bytes, "base64"));
    if (typeof tagged.$big === "string") return BigInt(tagged.$big);
  }
  return value as Value;
};
const encodeRow = (row: Row): Record<string, unknown> => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, encode(value)]));
const decodeRow = (row: Record<string, unknown>): Row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, decode(value)]));

/** The engine. It reads the schema on first use, after every migration has run. */
export function sqliteTrash(db: Database): TrashEngine {
  let engine: TrashEngine | null = null;
  const get = (): TrashEngine => (engine ??= build(db));
  return {
    plan: (kind, id) => get().plan(kind, id),
    moveToTrash: (kind, id, trash) => get().moveToTrash(kind, id, trash),
    restore: (trashId) => get().restore(trashId),
    purge: (trashId) => get().purge(trashId),
    list: () => get().list(),
  };
}

function build(db: Database): TrashEngine {
  // The schema, read once.
  const tables = (db.prepare("select name, sql from sqlite_master where type = 'table' and name not like 'sqlite_%'").all() as { name: string; sql: string }[]).filter((one) => !KEPT.has(one.name));
  const columns = new Map<string, { names: string[]; key: string[]; rowid: boolean }>();
  for (const table of tables) {
    const info = db.prepare(`pragma table_info(${ident(table.name)})`).all() as { name: string; pk: number }[];
    const key = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    columns.set(table.name, { names: info.map((c) => c.name), key, rowid: !/without\s+rowid/i.test(table.sql) });
  }
  const edges = new Map<string, Edge[]>();
  for (const table of tables) {
    const info = new Map((db.prepare(`pragma table_info(${ident(table.name)})`).all() as { name: string; notnull: number; pk: number }[]).map((c) => [c.name, c]));
    for (const fk of db.prepare(`pragma foreign_key_list(${ident(table.name)})`).all() as { table: string; from: string; to: string | null; on_delete: string }[]) {
      if (KEPT.has(fk.table)) continue;
      const column = info.get(fk.from);
      const cascade = Boolean(column && (column.notnull || column.pk)) || fk.on_delete === "CASCADE" || OWNER_COLUMNS.has(fk.from) || OWNER_EDGES.has(`${table.name}.${fk.from}`);
      const list = edges.get(fk.table) ?? [];
      list.push({ child: table.name, column: fk.from, to: fk.to ?? "id", cascade });
      edges.set(fk.table, list);
    }
  }

  const shape = (table: string) => {
    const found = columns.get(table);
    if (!found) throw new Error(`No table ${table}`);
    return found;
  };
  // A row's identity: its rowid, or its primary key in a table without one.
  const keyOf = (table: string, row: Row): Row => {
    const { key, rowid } = shape(table);
    return rowid ? { rowid: row["__rowid"] ?? null } : Object.fromEntries(key.map((column) => [column, row[column] ?? null]));
  };
  const keyText = (table: string, row: Row): string => `${table} ${JSON.stringify(encodeRow(keyOf(table, row)))}`;
  const select = (table: string) => `select ${shape(table).rowid ? "rowid as __rowid, " : ""}* from ${ident(table)}`;

  function rowsWhere(table: string, column: string, values: readonly Value[]): Row[] {
    const found: Row[] = [];
    for (let i = 0; i < values.length; i += 400) {
      const part = values.slice(i, i + 400);
      found.push(...(db.prepare(`${select(table)} where ${ident(column)} in (${part.map(() => "?").join(", ")})`).all(...(part as never[])) as Row[]));
    }
    return found;
  }

  /** The record's row and everything that belongs to it, and the links to clear. */
  function collect(kind: TrashKind, id: string): { rows: Map<string, Saved>; cleared: Cleared[] } | null {
    const root = db.prepare(`${select(ROOT_TABLE[kind])} where id = ?`).get(id) as Row | undefined;
    if (!root) return null;
    const rows = new Map<string, Saved>();
    const mentions: { table: string; row: Row; column: string }[] = [];
    let queue: Saved[] = [{ table: ROOT_TABLE[kind], row: root }];
    rows.set(keyText(ROOT_TABLE[kind], root), queue[0] as Saved);
    while (queue.length > 0) {
      const byTable = new Map<string, Row[]>();
      for (const one of queue) byTable.set(one.table, [...(byTable.get(one.table) ?? []), one.row]);
      const next: Saved[] = [];
      const take = (table: string, found: Row[]) => {
        for (const row of found) {
          const text = keyText(table, row);
          if (rows.has(text)) continue;
          const saved = { table, row };
          rows.set(text, saved);
          next.push(saved);
        }
      };
      for (const [table, parents] of byTable) {
        for (const edge of edges.get(table) ?? []) {
          const values = [...new Set(parents.map((row) => row[edge.to]).filter((value) => value !== null && value !== undefined))] as Value[];
          if (values.length === 0) continue;
          const found = rowsWhere(edge.child, edge.column, values);
          if (edge.cascade) take(edge.child, found);
          else for (const row of found) mentions.push({ table: edge.child, row, column: edge.column });
        }
        const ids = parents.map((row) => row["id"]).filter((value): value is string => typeof value === "string");
        if (ids.length > 0) {
          const kinds = [table.replaceAll("_", "-"), ...(KIND_EXTRAS[table] ?? [])];
          for (const [other, kindColumn, idColumn] of BY_KIND) {
            if (!columns.has(other)) continue;
            for (const named of kinds) take(other, rowsWhere(other, idColumn, ids).filter((row) => row[kindColumn] === named));
          }
        }
      }
      queue = next;
    }
    // A mention from a row that is going anyway needs no clearing.
    const cleared: Cleared[] = [];
    const seen = new Set<string>();
    for (const one of mentions) {
      const text = `${keyText(one.table, one.row)} ${one.column}`;
      if (rows.has(keyText(one.table, one.row)) || seen.has(text)) continue;
      seen.add(text);
      cleared.push({ table: one.table, key: keyOf(one.table, one.row), column: one.column, value: one.row[one.column] ?? null });
    }
    return { rows, cleared };
  }

  const counts = (rows: Iterable<Saved>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const one of rows) out[one.table] = (out[one.table] ?? 0) + 1;
    return out;
  };
  const where = (key: Row) => Object.keys(key).map((column) => `${column === "rowid" ? "rowid" : ident(column)} = ?`).join(" and ");

  // Run inside the caller's transaction.
  function locked<T>(fn: () => T): T {
    db.exec("pragma defer_foreign_keys = on");
    db.prepare("insert or ignore into record_delete_lock (one) values (1)").run();
    try {
      return fn();
    } finally {
      db.prepare("delete from record_delete_lock").run();
    }
  }

  const planOf = (kind: TrashKind, id: string): TrashPlanRow | null => {
    const found = collect(kind, id);
    if (!found) return null;
    const root = [...found.rows.values()][0]?.row as Row;
    const facts = describe(kind, root);
    return { kind, id, label: facts.label, clientName: facts.clientName, demo: facts.demo, counts: counts(found.rows.values()) };
  };

  // The record's name, and the client it's at, read from its own row.
  function describe(kind: TrashKind, row: Row): { label: string; clientName: string; demo: boolean } {
    const client = (organizationId: Value) => (organizationId ? (db.prepare("select name, demo from client_organization where id = ?").get(organizationId as string) as { name: string; demo: number } | undefined) : undefined);
    if (kind === "client") return { label: String(row["name"]), clientName: "", demo: row["demo"] === 1 || row["demo"] === 1n };
    if (kind === "proposal") {
      const at = db.prepare("select o.organization_id from opportunity o where o.id = ?").get(row["opportunity_id"] as string) as { organization_id: string } | undefined;
      const c = client(at?.organization_id ?? null);
      return { label: String(row["title"]), clientName: c?.name ?? "", demo: c?.demo === 1 };
    }
    const c = client(row["organization_id"] ?? null);
    const label = String(kind === "project" ? row["name"] : kind === "opportunity" ? row["title"] : row["name"]);
    return { label, clientName: c?.name ?? "", demo: c?.demo === 1 };
  }

  return {
    plan: planOf,

    moveToTrash(kind, id, trash) {
      const found = collect(kind, id);
      if (!found) return null;
      const root = [...found.rows.values()][0]?.row as Row;
      const facts = describe(kind, root);
      const summary = counts(found.rows.values());
      const snapshot: Snapshot = {
        rows: [...found.rows.values()].map((one) => ({ table: one.table, row: encodeRow(Object.fromEntries(Object.entries(one.row).filter(([column]) => column !== "__rowid"))) as Row })),
        cleared: found.cleared.map((one) => ({ ...one, key: encodeRow(one.key) as Row, value: encode(one.value) as Value })),
      };
      locked(() => {
        for (const one of found.cleared) db.prepare(`update ${ident(one.table)} set ${ident(one.column)} = null where ${where(one.key)}`).run(...(Object.values(one.key) as never[]));
        // Children first reads better in a trace; deferred keys make the order not matter.
        for (const one of [...found.rows.values()].reverse()) {
          const key = keyOf(one.table, one.row);
          db.prepare(`delete from ${ident(one.table)} where ${where(key)}`).run(...(Object.values(key) as never[]));
        }
      });
      db.prepare("insert into trash (id, kind, record_id, label, client_name, summary, snapshot, deleted_by, deleted_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(trash.id, kind, id, facts.label, facts.clientName, JSON.stringify(summary), JSON.stringify(snapshot), trash.by, trash.at);
      return { label: facts.label, counts: summary };
    },

    restore(trashId) {
      const found = db.prepare("select snapshot from trash where id = ?").get(trashId) as { snapshot: string } | undefined;
      if (!found) return "not-found";
      const snapshot = JSON.parse(found.snapshot) as { rows: { table: string; row: Record<string, unknown> }[]; cleared: { table: string; key: Record<string, unknown>; column: string; value: unknown }[] };
      db.exec("savepoint trash_restore");
      try {
        locked(() => {
          for (const one of snapshot.rows) {
            // A column dropped since the delete is left out; one added since takes its default.
            const known = new Set(shape(one.table).names);
            const row = Object.entries(decodeRow(one.row)).filter(([column]) => known.has(column));
            db.prepare(`insert into ${ident(one.table)} (${row.map(([column]) => ident(column)).join(", ")}) values (${row.map(() => "?").join(", ")})`).run(...(row.map(([, value]) => value) as never[]));
          }
          // A cleared link goes back only where the row is still there and nothing has been put in its place.
          for (const one of snapshot.cleared) {
            const key = decodeRow(one.key);
            db.prepare(`update ${ident(one.table)} set ${ident(one.column)} = ? where ${where(key)} and ${ident(one.column)} is null`).run(decode(one.value) as never, ...(Object.values(key) as never[]));
          }
        });
        db.exec("release trash_restore");
      } catch {
        // Something now takes a place the record had (an email, a code): nothing is put back.
        db.exec("rollback to trash_restore");
        db.exec("release trash_restore");
        return "conflict";
      }
      db.prepare("delete from trash where id = ?").run(trashId);
      return "restored";
    },

    purge(trashId) {
      return Number(db.prepare("delete from trash where id = ?").run(trashId).changes) > 0;
    },

    list(): TrashLine[] {
      return (db.prepare("select t.id, t.kind, t.record_id, t.label, t.client_name, t.summary, t.deleted_at, u.name as deleted_by from trash t left join user u on u.id = t.deleted_by order by t.deleted_at desc").all() as Record<string, string>[]).map((r) => ({
        id: r["id"] as string,
        kind: r["kind"] as TrashKind,
        recordId: r["record_id"] as string,
        label: r["label"] as string,
        clientName: r["client_name"] as string,
        counts: JSON.parse(r["summary"] as string) as Record<string, number>,
        deletedAt: r["deleted_at"] as string,
        deletedBy: r["deleted_by"] ?? "",
      }));
    },
  };
}
