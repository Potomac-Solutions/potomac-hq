// The second door into the shared module, for infrastructure code and bin/
// commands only: the database, the SQLite adapters and the system clock.
// Domain, application, api and ui code must not import this file. The
// boundary lint enforces it.
export { sqliteActivityLog } from "./infrastructure/activity-log.ts";
export { inTransaction, openDatabase, type Database } from "./infrastructure/database.ts";
export { newId } from "./infrastructure/ids.ts";
export { migrate, MigrationError, readMigrations, type Migration, type MigrationProblem } from "./infrastructure/migrations.ts";
export { sqliteTransact, systemClock } from "./infrastructure/system.ts";
export { backupConfigFrom, type BackupConfig } from "./infrastructure/backup/config.ts";
export { BackupFileError, open as openBackup, seal as sealBackup } from "./infrastructure/backup/envelope.ts";
export { backupName, nextRun, runBackup, scheduleDaily, type BackupDeps, type BackupResult } from "./infrastructure/backup/run-backup.ts";
export { directoryTarget, r2Target, type BackupTarget, type R2Config } from "./infrastructure/backup/targets.ts";
export { brevoSender, emailConfigFrom, type EmailConfig, type Send } from "./infrastructure/email/brevo.ts";
