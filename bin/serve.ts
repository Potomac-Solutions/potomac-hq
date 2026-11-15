// Starts Potomac HQ. Run `npm run migrate` first.
//   HQ_DATABASE_PATH   the SQLite file (required)
//   HQ_NOTICE_SECRET   signs one-line messages after redirects (required, 32+ characters)
//   HQ_SECURE          "true" when served over https (production)
//   HQ_PROXIES         trusted proxies in front: 1 on Railway, 0 locally
//   HQ_PUBLIC_URL      the address people use, for printed links
//   HQ_CACHE_DIR       a writable folder for compiled pages, inside the app's
//                      folder so they can import its packages (the container sets it)
//   PORT               defaults to 3000
import { createServer } from "node:http";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/shared/adapters.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name}.`);
    process.exit(2);
  }
  return value;
}

const databasePath = required("HQ_DATABASE_PATH");
const noticeSecret = required("HQ_NOTICE_SECRET");
if (noticeSecret.length < 32) {
  console.error("HQ_NOTICE_SECRET must be at least 32 characters.");
  process.exit(2);
}
const port = Number(process.env["PORT"] ?? 3000);
const publicUrl = (process.env["HQ_PUBLIC_URL"] ?? `http://localhost:${port}`).replace(/\/$/, "");

const db = openDatabase(databasePath);
const app = await createApp({
  db,
  secure: process.env["HQ_SECURE"] === "true",
  proxies: Number(process.env["HQ_PROXIES"] ?? 0),
  noticeSecret,
  ...(process.env["HQ_CACHE_DIR"] ? { cacheDir: process.env["HQ_CACHE_DIR"] } : {}),
});

const server = createServer(app.listener);
server.listen(port, async () => {
  console.log(`Potomac HQ is listening on port ${port}.`);
  const setup = await app.setupPath();
  if (setup) console.log(`Nobody has an account yet. Set up the first admin here (works once, for a day):\n${publicUrl}${setup}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
