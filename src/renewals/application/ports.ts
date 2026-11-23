import type { Renewal } from "../domain/renewal.ts";
import type { Id } from "../../shared/index.ts";

export type RenewalStore = {
  insert(renewal: Renewal, at: string): void;
  update(renewal: Renewal, at: string): void;
  get(id: Id): Renewal | null;
  /** Active ones, soonest first. */
  listActive(): Renewal[];
  /** A client's active ones, soonest first. */
  listFor(organizationId: Id): Renewal[];
};

/** A client's name, from the CRM. */
export type ClientNames = (organizationId: Id) => string | null;
