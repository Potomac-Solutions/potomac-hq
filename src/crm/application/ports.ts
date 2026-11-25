import type { Call } from "../domain/call.ts";
import type { Touch } from "../domain/touch.ts";
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

export type TouchStore = {
  insert(touch: Touch, at: string): void;
  /** A client's touches, newest first. */
  listForClient(organizationId: Id, limit: number): Touch[];
  listForOpportunity(opportunityId: Id, limit: number): Touch[];
  /** The newest touch at each client, for showing how long since. */
  lastByClient(): ReadonlyMap<Id, string>;
  /** Each open opportunity's last sign of life: the latest touch with its client, or its own last change, whichever is later. An instant. */
  lastActiveByOpportunity(): ReadonlyMap<Id, string>;
};

/** A booked call, as the call screen needs it (decision 0009). */
export type BookedCall = { readonly id: Id; readonly organizationId: Id | null; readonly name: string; readonly phone: string; readonly topic: string; readonly startsAt: string; readonly endsAt: string; readonly booked: boolean };

export type CallStore = {
  insert(call: Call, at: string): void;
  get(id: Id): Call | null;
  /** The person's open call, if they're on one. */
  openFor(userId: Id): Call | null;
  /** Saves the planned length, the warning and the note. */
  update(call: Call): void;
  end(id: Id, endedAt: string, touchId: Id | null): void;
  /** Open calls that started at or before this instant. */
  openStartedBy(instant: string): Call[];
  booking(id: Id): BookedCall | null;
};
