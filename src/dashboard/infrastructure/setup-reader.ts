// What Get HQ ready (decision 0015) reads straight from the tables: counts
// and the last backup. Reading changes nothing.
import type { Database } from "../../shared/adapters.ts";

export type SetupCounts = { readonly lastBackupAt: string | null; readonly bookingHours: number; readonly realClients: number; readonly activeUsers: number };

export function sqliteSetupCounts(db: Database): () => SetupCounts {
  const lastBackup = db.prepare("select max(occurred_at) as at from activity_event where action = 'backup.completed'");
  const hours = db.prepare("select count(*) as n from booking_hours");
  const clients = db.prepare("select count(*) as n from client_organization where demo = 0");
  const users = db.prepare("select count(*) as n from user where status = 'active'");
  const count = (statement: typeof hours): number => Number(statement.get()?.["n"] ?? 0);
  return () => ({
    lastBackupAt: (lastBackup.get()?.["at"] as string | null | undefined) ?? null,
    bookingHours: count(hours),
    realClients: count(clients),
    activeUsers: count(users),
  });
}

export type StatusCounts = {
  readonly lastBackupAt: string | null;
  readonly lastBackupFailedAt: string | null;
  readonly database: { readonly bytes: number; readonly migrations: number; readonly lastMigration: string };
};

/** What System status reads straight from the database. */
export function sqliteStatusCounts(db: Database): () => StatusCounts {
  const last = db.prepare("select max(occurred_at) as at from activity_event where action = ?");
  const pages = db.prepare("select page_count * page_size as bytes from pragma_page_count(), pragma_page_size()");
  const migrations = db.prepare("select count(*) as n, max(version) as version, (select name from schema_migration order by version desc limit 1) as name from schema_migration");
  const at = (action: string) => (last.get(action)?.["at"] as string | null | undefined) ?? null;
  return () => {
    const applied = migrations.get();
    return {
      lastBackupAt: at("backup.completed"),
      lastBackupFailedAt: at("backup.failed"),
      database: { bytes: Number(pages.get()?.["bytes"] ?? 0), migrations: Number(applied?.["n"] ?? 0), lastMigration: String(applied?.["name"] ?? "") },
    };
  };
}
