import type { Client } from "../domain/client.ts";
import type { Contact } from "../domain/contact.ts";
import type { Opportunity } from "../domain/opportunity.ts";
import type { Id } from "../../shared/index.ts";

export type ClientStore = {
  insert(client: Client, at: string): void;
  update(client: Client, at: string): void;
  get(id: Id): Client | null;
  /** Every client, newest first, with how many open opportunities each has. */
  list(): (Client & { readonly openOpportunities: number })[];
};

export type ContactStore = {
  insert(contact: Contact, at: string): void;
  /** Makes no contact of this client the primary one. */
  clearPrimary(organizationId: Id, at: string): void;
  get(id: Id): Contact | null;
  listFor(organizationId: Id): Contact[];
  /** A contact with this email, at any client, matched without regard to case. */
  byEmail(email: string): Contact | null;
};

export type OpportunityStore = {
  insert(opportunity: Opportunity, at: string): void;
  update(opportunity: Opportunity, at: string): void;
  get(id: Id): Opportunity | null;
  /** A client's opportunities, newest first. */
  listFor(organizationId: Id): Opportunity[];
  /** Every open opportunity with its client's name, oldest first. */
  listOpen(): (Opportunity & { readonly clientName: string })[];
  /** Open opportunities with a follow-up on or before `date`, soonest first. */
  dueBy(date: string): (Opportunity & { readonly clientName: string })[];
  /** Every opportunity, open or closed, oldest first. For reports. */
  listAll(): Opportunity[];
};
