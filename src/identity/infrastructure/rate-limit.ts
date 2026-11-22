import { createHash } from "node:crypto";
import type { RateLimit } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";

/**
 * At most `max` hits per key in each window, kept in memory. HQ itself uses
 * `sqliteRateLimit` below; this one is for tests and tools.
 */
export function memoryRateLimit(options: { max: number; windowMs: number; now?: () => number }): RateLimit {
  const now = options.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key) => {
    const at = now();
    if (hits.size >= 10_000) {
      for (const [k, entry] of hits) if (entry.resetAt <= at) hits.delete(k);
    }
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= at) {
      hits.set(key, { count: 1, resetAt: at + options.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= options.max;
  };
}

/**
 * The same limit, kept in the database, so a restart does not hand out a
 * fresh set of tries (security review, known gap 3). `name` keeps limits
 * apart; keys are stored only as hashes. Old windows are cleared as it goes,
 * and by retention.
 */
export function sqliteRateLimit(db: Database, options: { name: string; max: number; windowMs: number; now?: () => number }): RateLimit {
  const now = options.now ?? Date.now;
  const read = db.prepare("select count, reset_at from rate_limit where name = ? and key_hash = ?");
  const start = db.prepare("insert into rate_limit (name, key_hash, count, reset_at) values (?, ?, 1, ?) on conflict (name, key_hash) do update set count = 1, reset_at = excluded.reset_at");
  const bump = db.prepare("update rate_limit set count = count + 1 where name = ? and key_hash = ? returning count");
  const clear = db.prepare("delete from rate_limit where reset_at <= ?");
  let lastClear = 0;
  return (key) => {
    const at = now();
    if (at - lastClear > options.windowMs) {
      clear.run(at);
      lastClear = at;
    }
    const hash = createHash("sha256").update(key).digest("hex");
    const row = read.get(options.name, hash);
    if (!row || Number(row["reset_at"]) <= at) {
      start.run(options.name, hash, at + options.windowMs);
      return true;
    }
    return Number(bump.get(options.name, hash)?.["count"] ?? options.max + 1) <= options.max;
  };
}
