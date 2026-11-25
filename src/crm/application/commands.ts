// The CRM's changes. Each one checks permission first, makes its change and
// writes its activity event in one transaction, and answers with a code.
import { activateOnWin, changeClientStatus, newClient, type Client, type ClientError, type ClientInput } from "../domain/client.ts";
import { newContact, type Contact, type ContactError, type ContactInput } from "../domain/contact.ts";
import {
  isService,
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
import { err, ok, parseAmount, recordActivity, type ActivityDeps, type Id, type Money, type Result, type Transact } from "../../shared/index.ts";
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

/**
 * Marks a client as a demo (a made-up business shown to prospects), or as
 * real. Permission: `client.set-status`.
 */
export function setClientDemo(deps: CrmDeps, actorId: Id | null, clientId: Id, demo: boolean): Result<Client, Refused | "unchanged"> {
  if (!allowed(deps, actorId, "client.set-status")) return err("forbidden");
  return deps.transact(() => {
    const client = deps.clients.get(clientId);
    if (!client) return err("not-found");
    if ((client.demo === true) === demo) return err("unchanged");
    const changed = { ...client, demo };
    deps.clients.update(changed, deps.clock());
    recordActivity(deps, { actorId, action: "client.demo-changed", recordType: "client-organization", recordId: clientId, context: { demo } });
    return ok(changed);
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

/**
 * Who gets the client's bills: one of their contacts with an email, such as
 * a bookkeeper. Invoices, reminders, receipts and statements go to them.
 * Empty: the usual people again. `client.edit`.
 */
export function setBillingContact(deps: CrmDeps, actorId: Id | null, clientId: Id, contactId: string): Result<{ readonly contactId: Id | null }, Refused | "contact-not-at-client" | "contact-has-no-email"> {
  if (!allowed(deps, actorId, "client.edit")) return err("forbidden");
  return deps.transact(() => {
    if (!deps.clients.get(clientId)) return err("not-found");
    const wanted = contactId.trim();
    const contact = wanted === "" ? null : deps.contacts.get(wanted as Id);
    if (wanted !== "" && (!contact || contact.organizationId !== clientId)) return err("contact-not-at-client");
    if (contact && !contact.email) return err("contact-has-no-email");
    deps.clients.setBillingContact(clientId, contact?.id ?? null, deps.clock());
    recordActivity(deps, { actorId, action: "client.billing-contact-set", recordType: "client", recordId: clientId, context: { contactId: contact?.id ?? null } });
    return ok({ contactId: contact?.id ?? null });
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
    return applyOpportunityValue(deps, actorId, opportunity, input.pricing, amount.value);
  });
}

// The three functions below make a change and write its events, and nothing
// else: no permission check and no transaction of their own. They exist so
// that another module's use case (accepting a proposal) can price, win and
// convert an opportunity as one change. Call them only inside a transaction,
// after the calling use case has checked its own permission.

export function applyOpportunityValue(deps: CrmDeps, actorId: Id | null, opportunity: Opportunity, pricing: string, amount: Money): Result<Opportunity, ValueError> {
  const priced = setValue(opportunity, pricing, amount);
  if (!priced.ok) return priced;
  deps.opportunities.update(priced.value, deps.clock());
  recordActivity(deps, {
    actorId,
    action: "opportunity.value-set",
    recordType: "opportunity",
    recordId: opportunity.id,
    context: { pricing: priced.value.pricing, minor: amount.minor, currency: amount.currency },
  });
  return ok(priced.value);
}

/** Moving to won also makes the client active, recorded as its own event. */
export function applyStageMove(deps: CrmDeps, actorId: Id | null, opportunity: Opportunity, input: { readonly to: string; readonly lostReason?: string | null }): Result<Opportunity, StageError> {
  const at = deps.clock();
  const moved = moveStage(opportunity, input.to, { at, lostReason: input.lostReason ?? null });
  if (!moved.ok) return moved;
  deps.opportunities.update(moved.value, at);
  recordActivity(deps, {
    actorId,
    action: "opportunity.stage-changed",
    recordType: "opportunity",
    recordId: opportunity.id,
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
        context: { from: client.status, to: "active", because: "opportunity-won", opportunityId: opportunity.id },
      });
    }
  }
  return ok(moved.value);
}

export function applyConversion(deps: CrmDeps, actorId: Id | null, opportunity: Opportunity): Result<Project, "not-won" | "already-converted"> {
  if (deps.projects.byOpportunity(opportunity.id)) return err("already-converted");
  const project = projectFromWon(deps.newId(), opportunity);
  if (!project.ok) return project;
  deps.projects.insert(project.value, deps.clock());
  recordActivity(deps, { actorId, action: "opportunity.converted", recordType: "opportunity", recordId: opportunity.id, context: { projectId: project.value.id } });
  recordActivity(deps, {
    actorId,
    action: "project.created",
    recordType: "project",
    recordId: project.value.id,
    context: { opportunityId: opportunity.id, kind: project.value.kind, name: project.value.name },
  });
  return ok(project.value);
}

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
    return applyStageMove(deps, actorId, opportunity, input);
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
    return applyConversion(deps, actorId, opportunity);
  });
}

// ── Sign-ups from the booking page ───────────────────────────────────────

export type SignUpInput = { readonly name: string; readonly email: string; readonly phone?: string | null; readonly business?: string | null };
export type SignUpError = "name-missing" | "name-too-long" | "email-invalid" | "phone-invalid" | "business-too-long";

/**
 * Someone signed up to book a call: anyone on the internet, so no
 * permission, and HQ is the actor. Someone already in the CRM by email is
 * left as they are. Anyone else becomes a new prospective client with them
 * as its primary contact, and a new opportunity owned by `ownerId`, so they
 * show in the pipeline.
 */
export function recordSignUp(deps: CrmDeps, ownerId: Id, input: SignUpInput): Result<{ readonly clientId: Id; readonly contactId: Id; readonly known: boolean }, SignUpError> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) return err("name-missing");
  if (name.length > 100) return err("name-too-long");
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("email-invalid");
  const business = (input.business ?? "").trim().replace(/\s+/g, " ");
  if (business.length > 120) return err("business-too-long");
  const phone = (input.phone ?? "").trim();
  return deps.transact(() => {
    const at = deps.clock();
    const known = deps.contacts.byEmail(email);
    if (known) return ok({ clientId: known.organizationId, contactId: known.id, known: true });
    const client = newClient(deps.newId(), { name: business || name, sizeTier: "small" });
    if (!client.ok) return err("business-too-long");
    const contact = newContact(deps.newId(), client.value.id, { name, email, phone: phone || null, isPrimary: true });
    if (!contact.ok) return err(contact.error === "invalid-phone" ? "phone-invalid" : "email-invalid");
    deps.clients.insert(client.value, at);
    recordActivity(deps, { actorId: null, action: "client.created", recordType: "client-organization", recordId: client.value.id, context: { name: client.value.name, from: "sign-up" } });
    deps.contacts.insert(contact.value, at);
    recordActivity(deps, { actorId: null, action: "contact.created", recordType: "contact", recordId: contact.value.id, context: { clientId: client.value.id, primary: true } });
    const made = newOpportunity({ id: deps.newId(), organizationId: client.value.id, ownerId }, { title: `Signed up to book a call`, leadSource: "website", service: null, contactId: contact.value.id, summary: "Created an account on the booking page." });
    if (made.ok) {
      deps.opportunities.insert(made.value, at);
      recordActivity(deps, { actorId: null, action: "opportunity.signed-up", recordType: "opportunity", recordId: made.value.id, context: { clientId: client.value.id } });
    }
    return ok({ clientId: client.value.id, contactId: contact.value.id, known: false });
  });
}

// ── Inquiries from the website ───────────────────────────────────────────

export type InquiryInput = { readonly name: string; readonly email: string; readonly phone?: string | null; readonly business?: string | null; readonly message: string; readonly service?: string | null };
export type InquiryError = "name-missing" | "name-too-long" | "email-invalid" | "phone-invalid" | "business-too-long" | "message-missing" | "message-too-long" | "invalid-service";

/**
 * Someone filled in the inquiry form: anyone on the internet, so no
 * permission, and HQ is the actor. Someone already in the CRM by email gets
 * a new opportunity at their client; anyone else becomes a new client and
 * its primary contact. The opportunity is new, from the website, owned by
 * `ownerId`, with what they wrote as its summary.
 */
export function recordInquiry(deps: CrmDeps, ownerId: Id, input: InquiryInput): Result<{ readonly clientId: Id; readonly opportunityId: Id; readonly known: boolean }, InquiryError> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) return err("name-missing");
  if (name.length > 100) return err("name-too-long");
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("email-invalid");
  const business = (input.business ?? "").trim().replace(/\s+/g, " ");
  if (business.length > 120) return err("business-too-long");
  const message = input.message.trim();
  if (!message) return err("message-missing");
  if (message.length > 2000) return err("message-too-long");
  const service = (input.service ?? "").trim();
  if (service && !isService(service)) return err("invalid-service");
  const phone = (input.phone ?? "").trim();
  return deps.transact(() => {
    const at = deps.clock();
    const known = deps.contacts.byEmail(email);
    let clientId: Id;
    let contactId: Id;
    if (known) {
      clientId = known.organizationId;
      contactId = known.id;
    } else {
      const client = newClient(deps.newId(), { name: business || name, sizeTier: "small" });
      if (!client.ok) return err("business-too-long");
      deps.clients.insert(client.value, at);
      recordActivity(deps, { actorId: null, action: "client.created", recordType: "client-organization", recordId: client.value.id, context: { name: client.value.name, from: "inquiry" } });
      const contact = newContact(deps.newId(), client.value.id, { name, email, phone: phone || null, isPrimary: true });
      if (!contact.ok) return err(contact.error === "invalid-phone" ? "phone-invalid" : "email-invalid");
      deps.contacts.insert(contact.value, at);
      recordActivity(deps, { actorId: null, action: "contact.created", recordType: "contact", recordId: contact.value.id, context: { clientId: client.value.id, primary: true } });
      clientId = client.value.id;
      contactId = contact.value.id;
    }
    const first = message.split(/[.!?\n]/)[0]?.trim().slice(0, 80) || "Website inquiry";
    const made = newOpportunity({ id: deps.newId(), organizationId: clientId, ownerId }, { title: `Inquiry: ${first}`, leadSource: "website", service: service || null, contactId, summary: message.slice(0, 2000) });
    if (!made.ok) return err("message-too-long");
    deps.opportunities.insert(made.value, at);
    recordActivity(deps, { actorId: null, action: "opportunity.inquiry-received", recordType: "opportunity", recordId: made.value.id, context: { clientId, known: known !== null } });
    return ok({ clientId, opportunityId: made.value.id, known: known !== null });
  });
}
