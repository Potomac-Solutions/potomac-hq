import type { Clock, Transact } from "../application/ports.ts";
import { inTransaction, type Database } from "./database.ts";

/** The real clock: now, as a UTC ISO 8601 instant. */
export const systemClock: Clock = () => Temporal.Now.instant().toString();

export function sqliteTransact(db: Database): Transact {
  return (fn) => inTransaction(db, fn);
}
