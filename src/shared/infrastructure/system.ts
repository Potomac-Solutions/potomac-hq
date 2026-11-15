import type { Clock, Transact } from "../application/ports.ts";
import { inTransaction, type Database } from "./database.ts";

/**
 * The real clock: now, as a UTC ISO 8601 instant with exactly three decimal
 * places, so every stored time has the same width.
 */
export const systemClock: Clock = () => Temporal.Now.instant().toString({ fractionalSecondDigits: 3 });

export function sqliteTransact(db: Database): Transact {
  return (fn) => inTransaction(db, fn);
}
