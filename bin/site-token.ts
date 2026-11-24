// Makes the token potomac.solutions uses to ask HQ for its settings, and prints it once.
// Only a hash is kept. Run it again to replace the token; the old one stops working.
//   HQ_DATABASE_PATH=... npm run site:token
import { createServices } from "../src/services.ts";
import { openDatabase } from "../src/shared/adapters.ts";
import { issueSiteToken } from "../src/public-site/index.ts";

const databasePath = process.env["HQ_DATABASE_PATH"];
if (!databasePath) {
  console.error("Usage: HQ_DATABASE_PATH=<file> npm run site:token");
  process.exit(2);
}
const db = openDatabase(databasePath);
const token = issueSiteToken(createServices(db).publicSite);
db.close();
console.log(`Give the website service this as HQ_SITE_TOKEN (shown once):\n${token}`);
