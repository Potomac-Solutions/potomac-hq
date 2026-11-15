// Prints a one-time password reset link. Until HQ sends email, this is how a
// forgotten password is recovered (docs/scope-v0.1-v0.2.md).
//   HQ_DATABASE_PATH=... HQ_PUBLIC_URL=https://... npm run reset-link -- you@example.com
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/shared/adapters.ts";

const email = process.argv[2];
const databasePath = process.env["HQ_DATABASE_PATH"];
if (!email || !databasePath) {
  console.error("Usage: HQ_DATABASE_PATH=<file> npm run reset-link -- <email>");
  process.exit(2);
}

const db = openDatabase(databasePath);
const app = createApp({ db, secure: false, proxies: 0, noticeSecret: "not-used-by-this-command-0000000000" });
const path = await app.resetPath(email);
db.close();
if (!path) {
  console.error("No active account has that email.");
  process.exit(1);
}
const publicUrl = (process.env["HQ_PUBLIC_URL"] ?? "http://localhost:3000").replace(/\/$/, "");
console.log(`Reset link (works once, for a week):\n${publicUrl}${path}`);
