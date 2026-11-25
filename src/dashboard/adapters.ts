// Infrastructure door for the dashboard module. See src/shared/adapters.ts.
export { formatWhenIn, sqliteActivityReader, sqliteAuditReader } from "./infrastructure/activity-reader.ts";
export { sqliteSearchReader } from "./infrastructure/search-reader.ts";
export { sqliteSetupCounts, sqliteStatusCounts, sqliteWorkload, type SetupCounts, type StatusCounts } from "./infrastructure/setup-reader.ts";
export { sqlitePinStore } from "./infrastructure/pin-store.ts";
