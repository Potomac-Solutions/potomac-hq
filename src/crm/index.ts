// Public entry for the CRM module: client organizations, contacts and
// opportunities.
export * from "./application/commands.ts";
export * from "./application/queries.ts";
export type { ClientStore, ContactStore, OpportunityStore } from "./application/ports.ts";
export type { Client, ClientError, ClientStatus, SizeTier } from "./domain/client.ts";
export type { Contact, ContactError } from "./domain/contact.ts";
export type { Opportunity, OpportunityError, StageError, ValueError } from "./domain/opportunity.ts";
export * from "./application/touches.ts";
export type { TouchStore } from "./application/ports.ts";
export * from "./application/import.ts";
