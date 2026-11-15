import { randomUUID } from "node:crypto";
import type { Id } from "../domain/id.ts";

/** A new random record id. */
export function newId(): Id {
  return randomUUID() as Id;
}
