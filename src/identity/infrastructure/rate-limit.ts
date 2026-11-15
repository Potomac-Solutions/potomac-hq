import type { RateLimit } from "../application/ports.ts";

/**
 * At most `max` hits per key in each window. Kept in memory: HQ runs as one
 * instance (decision 0001), and a restart only resets the counts.
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
