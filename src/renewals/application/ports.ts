import type { Renewal } from "../domain/renewal.ts";
import type { Id, Money, Result } from "../../shared/index.ts";

export type RenewalStore = {
  insert(renewal: Renewal, at: string): void;
  update(renewal: Renewal, at: string): void;
  get(id: Id): Renewal | null;
  /** Active ones, soonest first. */
  listActive(): Renewal[];
  /** A client's active ones, soonest first. */
  listFor(organizationId: Id): Renewal[];
  /** Records the client's answer for a term. */
  answer(id: Id, answer: NonNullable<Renewal["answer"]>, at: string): void;
};

/** A client's name, from the CRM. */
export type ClientNames = (organizationId: Id) => string | null;

/** An invoice sent for a renewal, as far as renewals need to know it. */
export type BilledInvoice = { readonly id: Id; readonly label: string; readonly status: "sent" | "paid" | "void" | "draft"; readonly owedMinor: number };

/**
 * Billing a client for a renewal, through finance: renewals never make an
 * invoice themselves. `send` checks the actor may (`invoice.edit`) and
 * writes finance's own events.
 */
export type RenewalBilling = {
  /** The client's projects an invoice can go on, newest first. */
  projectsFor(organizationId: Id): readonly { readonly id: Id; readonly name: string }[];
  /** Makes an invoice with one line on one of the client's projects, and sends it. */
  send(actorId: Id | null, organizationId: Id, projectId: Id | null, line: { readonly description: string; readonly amount: Money; readonly dueOn: string }): Result<BilledInvoice, "forbidden" | "not-found">;
  invoice(id: Id): BilledInvoice | null;
  /** Whether the actor may bill: `invoice.edit`. */
  mayBill(actorId: Id | null): boolean;
};
