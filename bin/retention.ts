// Applies the retention policy now (docs/retention-policy.md). The server
// does the same every night.
//   HQ_DATABASE_PATH=... npm run retention
import { applyRetention, newId, openDatabase, sqliteActivityLog, sqliteTransact, systemClock } from "../src/shared/adapters.ts";

const databasePath = process.env["HQ_DATABASE_PATH"];
if (!databasePath) {
  console.error("Set HQ_DATABASE_PATH.");
  process.exit(2);
}
const db = openDatabase(databasePath);
try {
  const removed = applyRetention({ db, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock: systemClock, newId });
  console.log(`Removed ${removed.sessions} expired sessions, ${removed.links} expired links and ${removed.invites} unused invites.`);
} finally {
  db.close();
}
