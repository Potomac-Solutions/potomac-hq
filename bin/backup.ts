// Takes one backup now, with the same settings the nightly run uses.
//   HQ_DATABASE_PATH=... HQ_BACKUP_PUBLIC_KEY_FILE=... HQ_BACKUP_DIR=... npm run backup
import { backupConfigFrom, newId, openDatabase, runBackup, sqliteActivityLog, sqliteTransact, systemClock } from "../src/shared/adapters.ts";

const databasePath = process.env["HQ_DATABASE_PATH"];
if (!databasePath) {
  console.error("Set HQ_DATABASE_PATH.");
  process.exit(2);
}
const config = backupConfigFrom(process.env);
if (!config) {
  console.error("Backups are not set up. See .env.example.");
  process.exit(2);
}
const db = openDatabase(databasePath);
try {
  const result = await runBackup({
    db,
    transact: sqliteTransact(db),
    activityLog: sqliteActivityLog(db),
    clock: systemClock,
    newId,
    ...config,
  });
  console.log(`Saved ${result.name} (${result.bytes} bytes) to ${config.target.describe}.`);
} catch (error) {
  console.error("Backup failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  db.close();
}
