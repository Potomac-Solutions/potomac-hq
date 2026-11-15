// The CRM's changes. Each one checks permission first, makes its change and
// writes its activity event in one transaction, and answers with a code.
import { activateOnWin, changeClientStatus, newClient, type Client, type ClientError, type ClientInput } from "../domain/client.ts";
import { newContact, type Contact, type ContactError, type ContactInput } from "../domain/contact.ts";
import {
  moveStage,
  newOpportunity,
  setFollowUp,
  setValue,
  type Opportunity,
  type OpportunityError,
  type OpportunityInput,
  type StageError,
  type ValueError,
} from "../domain/opportunity.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { projectFromWon, type Project, type ProjectStore } from "../../projects/index.ts";
import { err, ok, parseAmount, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { ClientStore, ContactStore, OpportunityStore } from "./ports.ts";

export type CrmDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly clients: ClientStore;
  readonly contacts: ContactStore;
  readonly opportunities: OpportunityStore;
  readonly projects: ProjectStore;
};

export type Refused = "forbidden" | "not-found";

/** Runs `change` only if the actor holds `action`. */
function allowed(deps: CrmDeps, actorId: Id | null, action: string): actorId is Id {
  return actorId !== null && authorize(deps, actorId, action).ok;
}

export function createClient(deps: CrmDeps, actorId: Id | null, input: ClientInput): Result<Client, Refused | ClientError> {
  if (!allowed(deps, actorId, "client.create")) return err("forbidden");
  const client = newClient(deps.newId(), input);
  if (!client.ok) return client;
  return deps.transact(() => {
    deps.clients.insert(client.value, deps.clock());
    recordActivity(deps, { actorId, action: "client.created", recordType: "client-organization", recordId: client.value.id, context: { name: client.value.name } });
    return ok(client.value);
  });
}

export function setClientStatus(deps: CrmDeps, actorId: Id | null, clientId: Id, to: string): Result<Client, Refused | "invalid-status" | "unchanged"> {
  if (!allowed(deps, actorId, "client.set-status")) return err("forbidden");
  return deps.transact(() => {
    const client = deps.clients.get(clientId);
    if (!client) return err("not-found");
    const changed = changeClientStatus(client, to);
    if (!changed.ok) return changed;
    deps.clients.update(changed.value, deps.clock());
    recordActivity(deps, { actorId, action: "client.status-changed", recordType: "client-organization", recordId: clientId, context: { from: client.status, to: changed.value.status } });
    return ok(changed.value);
  });
}

export function addContact(deps: CrmDeps, actorId: Id | null, clientId: Id, input: ContactInput): Result<Contact, Refused | ContactError> {
  if (!allowed(deps, actorId, "contact.edit")) return err("forbidden");
  return deps.transact(() => {
    if (!deps.clients.get(clientId)) return err("not-found");
    const contact = newContact(deps.newId(), clientId, input);
    if (!contact.ok) return contact;
    const at = deps.clock();
    if (contact.value.isPrimary) deps.contacts.clearPrimary(clientId, at);
    deps.contacts.insert(contact.value, at);
    recordActivity(deps, { actorId, action: "contact.created", recordType: "contact", recordId: contact.value.id, context: { clientId, primary: contact.value.isPrimary } });
    return ok(contact.value);
  });
}

export type CreateOpportunityError = Refused | OpportunityError | "contact-not-at-client";

/** The actor owns the opportunity they create. Pricing and value are set separately. */
export function createOpportunity(deps: CrmDeps, actorId: Id | null, clientId: Id, input: OpportunityInput): Result<Opportunity, CreateOpportunityError> {
  if (!allowed(deps, actorId, "opportunity.create")) return err("forbidden");
  return deps.transact(() => {
    if (!deps.clients.get(clientId)) return err("not-found");
    if (input.contactId) {
      const contact = deps.contacts.get(input.contactId);
      if (!contact || contact.organizationId !== clientId) return err("contact-not-at-client");
    }
    const made = newOpportunity({ id: deps.newId(), organizationId: clientId, ownerId: actorId }, input);
    if (!made.ok) return made;
    deps.opportunities.insert(made.value, deps.clock());
    recordActivity(deps, {
      actorId,
      action: "opportunity.created",
      recordType: "opportunity",
      recordId: made.value.id,
      context: { clientId, title: made.value.title, service: made.value.service, leadSource: made.value.leadSource },
    });
    return ok(made.value);
  });
}

export function setOpportunityValue(
  deps: CrmDeps,
  actorId: Id | null,
  opportunityId: Id,
  input: { readonly pricing: string; readonly amount: string },
): Result<Opportunity, Refused | ValueError | "not-an-amount" | "not-whole-minor-units" | "unknown-currency"> {
  if (!allowed(deps, actorId, "opportunity.set-value")) return err("forbidden");
  const amount = parseAmount(input.pricing === "free" && input.amount.trim() === "" ? "0" : input.amount, "USD");
  if (!amount.ok) return amount;
  return deps.transact(() => {
    const opportunity = deps.opportunities.get(opportunityId);
    if (!opportunity) return err("not-found");
    const priced = setValue(opportunity, input.pricing, amount.value);
    if (!priced.ok) return priced;
    deps.opportunities.update(priced.value, deps.clock());
    recordActivity(deps, {
      actorId,
      action: "opportunity.value-set",
      recordType: "opportunity",
      recordId: opportunityId,
      context: { pricing: priced.value.pricing, minor: amount.value.minor, currency: amount.value.currency },
    });
    return ok(priced.value);
  });
}

/** Moving to won also makes the client active, recorded as its own event. */
export function moveOpportunity(
  deps: CrmDeps,
  actorId: Id | null,
  opportunityId: Id,
  input: { readonly to: string; readonly lostReason?: string | null },
): Result<Opportunity, Refused | StageError> {
  if (!allowed(deps, actorId, "opportunity.set-stage")) return err("forbidden");
  return deps.transact(() => {
    const opportunity = deps.opportunities.get(opportunityId);
    if (!opportunity) return err("not-found");
    const at = deps.clock();
    const moved = moveStage(opportunity, input.to, { at, lostReason: input.lostReason ?? null });
    if (!moved.ok) return moved;
    deps.opportunities.update(moved.value, at);
    recordActivity(deps, {
      actorId,
      action: "opportunity.stage-changed",
      recordType: "opportunity",
      recordId: opportunityId,
      context: { from: opportunity.stage, to: moved.value.stage, ...(moved.value.lostReason ? { lostReason: moved.value.lostReason } : {}) },
    });
    if (moved.value.stage === "won") {
      const client = deps.clients.get(opportunity.organizationId);
      const active = client ? activateOnWin(client) : null;
      if (client && active) {
        deps.clients.update(active, at);
        recordActivity(deps, {
          actorId,
          action: "client.status-changed",
          recordType: "client-organization",
          recordId: client.id,
          context: { from: client.status, to: "active", because: "opportunity-won", opportunityId },
        });
      }
    }
    return ok(moved.value);
  });
}

export function setOpportunityFollowUp(deps: CrmDeps, actorId: Id | null, opportunityId: Id, on: string | null): Result<Opportunity, Refused | "closed" | "invalid-date"> {
  if (!allowed(deps, actorId, "opportunity.set-follow-up")) return err("forbidden");
  return deps.transact(() => {
    const opportunity = deps.opportunities.get(opportunityId);
    if (!opportunity) return err("not-found");
    const changed = setFollowUp(opportunity, on);
    if (!changed.ok) return changed;
    deps.opportunities.update(changed.value, deps.clock());
    recordActivity(deps, { actorId, action: "opportunity.follow-up-set", recordType: "opportunity", recordId: opportunityId, context: { on: changed.value.followUpOn } });
    return ok(changed.value);
  });
}

export function convertOpportunity(deps: CrmDeps, actorId: Id | null, opportunityId: Id): Result<Project, Refused | "not-won" | "already-converted"> {
  if (!allowed(deps, actorId, "opportunity.convert")) return err("forbidden");
  return deps.transact(() => {
    const opportunity = deps.opportunities.get(opportunityId);
    if (!opportunity) return err("not-found");
    if (deps.projects.byOpportunity(opportunityId)) return err("already-converted");
    const project = projectFromWon(deps.newId(), opportunity);
    if (!project.ok) return project;
    deps.projects.insert(project.value, deps.clock());
    recordActivity(deps, { actorId, action: "opportunity.converted", recordType: "opportunity", recordId: opportunityId, context: { projectId: project.value.id } });
    recordActivity(deps, {
      actorId,
      action: "project.created",
      recordType: "project",
      recordId: project.value.id,
      context: { opportunityId, kind: project.value.kind, name: project.value.name },
    });
    return ok(project.value);
  });
}
