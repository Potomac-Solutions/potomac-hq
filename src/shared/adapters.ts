// The second door into the shared module, for infrastructure code and bin/
// commands only: the database, the SQLite adapters and the system clock.
// Domain, application, api and ui code must not import this file. The
// boundary lint enforces it.
export { sqliteActivityLog } from "./infrastructure/activity-log.ts";
export { inTransaction, openDatabase, type Database } from "./infrastructure/database.ts";
export { newId } from "./infrastructure/ids.ts";
export { migrate, MigrationError, readMigrations, type Migration, type MigrationProblem } from "./infrastructure/migrations.ts";
export { sqliteTransact, systemClock } from "./infrastructure/system.ts";
