// Applies the retention policy now (docs/retention-policy.md). The server
// does the same every night.
//   HQ_DATABASE_PATH=... npm run retention
import { applyRetention, newId, openDatabase, sqliteActivityLog, sqliteTransact, systemClock } from "../src/shared/adapters.ts";
import { createServices } from "../src/services.ts";
import { purgeExpiredTrash } from "../src/trash/index.ts";

const databasePath = process.env["HQ_DATABASE_PATH"];
if (!databasePath) {
  console.error("Set HQ_DATABASE_PATH.");
  process.exit(2);
}
const db = openDatabase(databasePath);
try {
  const removed = applyRetention({ db, transact: sqliteTransact(db), activityLog: sqliteActivityLog(db), clock: systemClock, newId });
  console.log(`Removed ${removed.sessions} expired sessions, ${removed.links} expired links, ${removed.invites} unused invites and ${removed.receipts} unused AI receipt drafts.`);
  // The Trash keeps a deleted record 30 days (decision 0023).
  const purged = purgeExpiredTrash(createServices(db).trash);
  if (purged > 0) console.log(`Purged ${purged} records deleted from HQ more than 30 days ago.`);
} finally {
  db.close();
}
