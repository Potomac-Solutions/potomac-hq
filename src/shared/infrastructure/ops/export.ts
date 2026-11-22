// A full export of HQ's data (roadmap v1.0), so the business can always take
// its records somewhere else. One JSON file per table, and every stored file
// as itself.
//
// Sign-in secrets are left out: the kit's table holds password hashes,
// sessions and one-time links, which are no use anywhere else and are a risk
// in a folder on someone's computer. Two-factor secrets, recovery code
// hashes and passed sessions too. A backup is the way to move HQ whole.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "../database.ts";

const LEFT_OUT = new Set(["kit_document", "file_blob", "user_two_factor", "two_factor_recovery", "two_factor_session"]);

export type ExportResult = { readonly tables: readonly { readonly name: string; readonly rows: number }[]; readonly files: number; readonly leftOut: readonly string[] };

/** A file name that is safe on any computer, keeping the ending. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-80);
  return cleaned || "file";
}

/** Writes the export into `dir`, which must be empty or not exist yet. */
export function exportAll(db: Database, dir: string, exportedAt: string): ExportResult {
  mkdirSync(join(dir, "files"), { recursive: true });
  const names = (db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as { name: string }[]).map((row) => row.name);
  const tables: { name: string; rows: number }[] = [];
  for (const name of names) {
    if (LEFT_OUT.has(name)) continue;
    // Table names come from the database's own list, never from a person.
    const rows = db.prepare(`select * from "${name}"`).all();
    writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
    tables.push({ name, rows: rows.length });
  }
  const blobs = db.prepare("select f.id, f.name, b.body from file f join file_blob b on b.file_id = f.id order by f.created_at, f.id");
  let files = 0;
  for (const row of blobs.iterate() as IterableIterator<{ id: string; name: string; body: Uint8Array }>) {
    writeFileSync(join(dir, "files", `${row.id}-${safeFileName(row.name)}`), row.body, { mode: 0o600 });
    files += 1;
  }
  const leftOut = names.filter((name) => LEFT_OUT.has(name));
  const manifest = {
    exportedAt,
    what: "Potomac HQ full data export",
    tables,
    files,
    leftOut: { kit_document: "Password hashes, sessions and one-time links. Not exported.", file_blob: "File contents. Exported as the files in files/, named <file id>-<name>.", user_two_factor: "Two-factor secrets. Not exported.", two_factor_recovery: "Hashes of recovery codes. Not exported.", two_factor_session: "Sessions. Not exported." },
    notes: ["Money is in minor units (cents) with a currency.", "Times are UTC. Days are in the business time zone, America/New_York.", "activity_event is the audit log."],
  };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { tables, files, leftOut };
}
