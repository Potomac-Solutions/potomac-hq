// Writes every record HQ holds into a folder: one JSON file per table, and
// every stored file as itself. Sign-in secrets are left out.
//   HQ_DATABASE_PATH=... npm run export -- <new folder>
import { existsSync, readdirSync } from "node:fs";
import { exportAll, newId, openDatabase, sqliteActivityLog, sqliteTransact, systemClock } from "../src/shared/adapters.ts";
import { recordActivity } from "../src/shared/index.ts";

const databasePath = process.env["HQ_DATABASE_PATH"];
const [dir] = process.argv.slice(2);
if (!databasePath || !dir) {
  console.error("Usage: HQ_DATABASE_PATH=<database file> npm run export -- <new folder>");
  process.exit(2);
}
if (existsSync(dir) && readdirSync(dir).length > 0) {
  console.error(`${dir} is not empty. Export to a new folder.`);
  process.exit(1);
}
const db = openDatabase(databasePath);
try {
  const result = exportAll(db, dir, systemClock());
  const rows = result.tables.reduce((sum, table) => sum + table.rows, 0);
  // Run from the server by someone with access to it, so there is no
  // signed-in actor. The event still says it happened.
  sqliteTransact(db)(() => {
    recordActivity({ activityLog: sqliteActivityLog(db), clock: systemClock, newId }, { actorId: null, action: "data.exported", recordType: "export", recordId: newId(), context: { by: "server-command", tables: result.tables.length, rows, files: result.files } });
  });
  console.log(`Exported ${rows} rows from ${result.tables.length} tables and ${result.files} files to ${dir}.`);
  console.log(`Left out: ${result.leftOut.join(", ")} (see manifest.json).`);
  console.log("This folder holds client records. Keep it somewhere safe and delete it when you are done.");
} finally {
  db.close();
}
