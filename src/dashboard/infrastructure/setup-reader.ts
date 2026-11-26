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
