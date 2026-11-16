// Opens a backup with the private key and writes the database file. Run it on
// your own computer, or wherever the private key is. It never overwrites a file.
//   HQ_BACKUP_KEY_PASSPHRASE=... npm run restore -- <backup file> <private key file> <new database file>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { BackupFileError, openBackup, openDatabase } from "../src/shared/adapters.ts";

const [input, keyFile, output] = process.argv.slice(2);
if (!input || !keyFile || !output) {
  console.error("Usage: HQ_BACKUP_KEY_PASSPHRASE=<passphrase> npm run restore -- <backup file> <private key file> <new database file>");
  process.exit(2);
}
if (existsSync(output)) {
  console.error(`${output} already exists. Restore to a new file, check it, then swap it in.`);
  process.exit(1);
}
const passphrase = process.env["HQ_BACKUP_KEY_PASSPHRASE"];
try {
  const { plain, createdAt } = openBackup(readFileSync(input), {
    key: readFileSync(keyFile, "utf8"),
    ...(passphrase ? { passphrase } : {}),
  });
  writeFileSync(output, plain, { mode: 0o600 });
  const db = openDatabase(output);
  const check = db.prepare("pragma integrity_check").get()?.["integrity_check"];
  const migrations = db.prepare("select count(*) as n from schema_migration").get()?.["n"];
  const events = db.prepare("select count(*) as n from activity_event").get()?.["n"];
  db.close();
  if (check !== "ok") {
    console.error(`Restored, but SQLite's integrity check says: ${String(check)}`);
    process.exit(1);
  }
  console.log(`Restored the backup taken ${createdAt} to ${output}.`);
  console.log(`Integrity check: ok. Migrations: ${String(migrations)}. Activity events: ${String(events)}.`);
} catch (error) {
  if (error instanceof BackupFileError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
