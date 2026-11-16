// The checks a restore drill runs on a restored copy of the database
// (roadmap v1.0). A backup is only worth having if it opens, is whole, and
// matches the code that will read it.
import type { Database } from "../database.ts";
import type { Migration } from "../migrations.ts";

export type DrillCheck = { readonly name: string; readonly ok: boolean; readonly detail: string };
export type DrillReport = { readonly ok: boolean; readonly checks: readonly DrillCheck[]; readonly counts: Readonly<Record<string, number>>; readonly newestEvent: string | null };

const COUNTED = ["user", "client_organization", "opportunity", "project", "task", "proposal", "invoice", "file", "article", "activity_event"];

export function checkRestored(db: Database, migrations: readonly Migration[]): DrillReport {
  const checks: DrillCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const integrity = String(db.prepare("pragma integrity_check").get()?.["integrity_check"]);
  add("The file is whole", integrity === "ok", integrity === "ok" ? "SQLite's integrity check passed." : integrity);

  const broken = db.prepare("pragma foreign_key_check").all();
  add("Every record's links hold", broken.length === 0, broken.length === 0 ? "No record points at one that is missing." : `${broken.length} broken links.`);

  const tables = new Set((db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((row) => row.name));
  const applied = tables.has("schema_migration") ? (db.prepare("select version, name, checksum from schema_migration order by version").all() as { version: number; name: string; checksum: string }[]) : [];
  const fileFor = (version: number) => migrations.find((file) => file.version === version);
  const changed = applied.filter((row) => {
    const file = fileFor(row.version);
    return file !== undefined && file.checksum !== row.checksum;
  });
  const ahead = applied.some((row) => fileFor(row.version) === undefined);
  add(
    "The schema matches this code",
    applied.length > 0 && changed.length === 0 && !ahead,
    applied.length === 0
      ? "The copy has no migrations recorded."
      : changed.length > 0
        ? `Migration ${changed[0]?.version} in the copy is not the one in this code.`
        : ahead
          ? "The copy is from newer code than this."
          : applied.length === migrations.length
            ? `All ${migrations.length} migrations are applied.`
            : `${applied.length} of ${migrations.length} migrations are applied. The rest apply when HQ starts.`,
  );

  const counts: Record<string, number> = {};
  for (const table of COUNTED) if (tables.has(table)) counts[table] = Number(db.prepare(`select count(*) as n from "${table}"`).get()?.["n"]);
  add("It holds records", (counts["user"] ?? 0) > 0, (counts["user"] ?? 0) > 0 ? `${counts["user"]} users, ${counts["activity_event"] ?? 0} activity events.` : "There are no users in the copy.");

  const missing = tables.has("file") && tables.has("file_blob") ? Number(db.prepare("select count(*) as n from file f left join file_blob b on b.file_id = f.id where b.file_id is null").get()?.["n"]) : 0;
  add("Every file has its contents", missing === 0, missing === 0 ? "No file record is missing its bytes." : `${missing} files have no contents.`);

  const newestEvent = tables.has("activity_event") ? ((db.prepare("select max(occurred_at) as at from activity_event").get()?.["at"] as string | null) ?? null) : null;
  return { ok: checks.every((check) => check.ok), checks, counts, newestEvent };
}
