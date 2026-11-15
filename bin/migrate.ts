// Applies pending migrations. The deploy runs this before starting HQ.
//   HQ_DATABASE_PATH=data/hq.db npm run migrate
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { migrate, MigrationError, openDatabase, readMigrations } from "../src/shared/adapters.ts";

const path = process.env["HQ_DATABASE_PATH"];
if (!path) {
  console.error("Set HQ_DATABASE_PATH to the SQLite file.");
  process.exit(2);
}

try {
  mkdirSync(dirname(path), { recursive: true });
  const db = openDatabase(path);
  const migrations = readMigrations(join(import.meta.dirname, "..", "migrations"));
  const applied = migrate(db, migrations, () => Temporal.Now.instant().toString());
  db.close();
  if (applied.length === 0) {
    console.log(`Nothing to apply. ${migrations.length} migration(s) already in place.`);
  } else {
    for (const m of applied) console.log(`Applied ${String(m.version).padStart(4, "0")}-${m.name}`);
  }
} catch (error) {
  if (error instanceof MigrationError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
