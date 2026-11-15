// What the CRM's pages show. Each read checks permission. A deal's price is
// left out entirely for anyone without `opportunity.view-value`.
import { CLIENT_STATUS_LABELS, LEAD_SOURCE_LABELS, options, PRICING_LABELS, priceLabel, SERVICE_LABELS, SIZE_TIER_LABELS, STAGE_LABELS } from "../domain/labels.ts";
import { isFollowUpDue, isOpen, nextStage, type Opportunity } from "../domain/opportunity.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, type Id, type Result } from "../../shared/index.ts";
import type { CrmDeps, Refused } from "./commands.ts";

export type Option = { readonly value: string; readonly label: string };

export type ClientListView = {
  readonly clients: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly statusLabel: string;
    readonly sizeTierLabel: string;
    readonly openOpportunities: number;
  }[];
  readonly canCreate: boolean;
  readonly sizeTiers: readonly Option[];
};

export type OpportunityRow = {
  readonly id: string;
  readonly title: string;
  readonly stageLabel: string;
  readonly serviceLabel: string;
  readonly followUpOn: string;
  readonly open: boolean;
  /** Empty for anyone who may not see deal values. */
  readonly price: string;
};

export type ClientDetailView = {
  readonly client: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly statusLabel: string;
    readonly sizeTierLabel: string;
    readonly website: string;
    readonly phone: string;
    readonly address: string;
  };
  readonly contacts: readonly { readonly id: string; readonly name: string; readonly email: string; readonly phone: string; readonly title: string; readonly isPrimary: boolean }[];
  readonly opportunities: readonly OpportunityRow[];
  readonly can: { readonly setStatus: boolean; readonly addContact: boolean; readonly createOpportunity: boolean; readonly viewOpportunities: boolean };
  readonly statuses: readonly Option[];
  readonly services: readonly Option[];
  readonly leadSources: readonly Option[];
};

export type OpportunityDetailView = {
  readonly opportunity: {
    readonly id: string;
    readonly title: string;
    readonly stage: string;
    readonly stageLabel: string;
    readonly serviceLabel: string;
    readonly leadSourceLabel: string;
    readonly followUpOn: string;
    readonly followUpDue: boolean;
    readonly summary: string;
    readonly lostReason: string;
    readonly open: boolean;
    readonly won: boolean;
    readonly price: string;
    readonly pricing: string;
    readonly amount: string;
  };
  readonly client: { readonly id: string; readonly name: string };
  readonly contactName: string;
  readonly ownerName: string;
  readonly nextStage: string;
  readonly nextStageLabel: string;
  /** A free landing page may go from consulted straight to won. */
  readonly canSkipToWon: boolean;
  readonly project: { readonly id: string; readonly name: string } | null;
  readonly can: {
    readonly setStage: boolean;
    readonly viewValue: boolean;
    readonly setValue: boolean;
    readonly setFollowUp: boolean;
    readonly convert: boolean;
  };
  readonly pricings: readonly Option[];
};

export type FollowUpsView = {
  readonly items: readonly { readonly id: string; readonly title: string; readonly clientName: string; readonly followUpOn: string; readonly overdue: boolean }[];
};

const may = (deps: CrmDeps, actorId: Id | null, action: string): boolean => actorId !== null && authorize(deps, actorId, action).ok;

function row(opportunity: Opportunity, showValue: boolean): OpportunityRow {
  return {
    id: opportunity.id,
    title: opportunity.title,
    stageLabel: STAGE_LABELS[opportunity.stage] ?? opportunity.stage,
    serviceLabel: opportunity.service ? (SERVICE_LABELS[opportunity.service] ?? opportunity.service) : "Not chosen yet",
    followUpOn: opportunity.followUpOn ?? "",
    open: isOpen(opportunity),
    price: showValue ? (priceLabel(opportunity.pricing, opportunity.value) ?? "") : "",
  };
}

export function listClients(deps: CrmDeps, actorId: Id | null): Result<ClientListView, "forbidden"> {
  if (!may(deps, actorId, "client.view")) return err("forbidden");
  return ok({
    clients: deps.clients.list().map((client) => ({
      id: client.id,
      name: client.name,
      status: client.status,
      statusLabel: CLIENT_STATUS_LABELS[client.status] ?? client.status,
      sizeTierLabel: client.sizeTier ? (SIZE_TIER_LABELS[client.sizeTier] ?? client.sizeTier) : "",
      openOpportunities: client.openOpportunities,
    })),
    canCreate: may(deps, actorId, "client.create"),
    sizeTiers: options(SIZE_TIER_LABELS),
  });
}

export function clientDetail(deps: CrmDeps, actorId: Id | null, clientId: Id): Result<ClientDetailView, Refused> {
  if (!may(deps, actorId, "client.view")) return err("forbidden");
  const client = deps.clients.get(clientId);
  if (!client) return err("not-found");
  const viewOpportunities = may(deps, actorId, "opportunity.view");
  const showValue = may(deps, actorId, "opportunity.view-value");
  return ok({
    client: {
      id: client.id,
      name: client.name,
      status: client.status,
      statusLabel: CLIENT_STATUS_LABELS[client.status] ?? client.status,
      sizeTierLabel: client.sizeTier ? (SIZE_TIER_LABELS[client.sizeTier] ?? client.sizeTier) : "",
      website: client.website ?? "",
      phone: client.phone ?? "",
      address: client.address ?? "",
    },
    contacts: deps.contacts.listFor(clientId).map((contact) => ({
      id: contact.id,
      name: contact.name,
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      title: contact.title ?? "",
      isPrimary: contact.isPrimary,
    })),
    opportunities: viewOpportunities ? deps.opportunities.listFor(clientId).map((o) => row(o, showValue)) : [],
    can: {
      setStatus: may(deps, actorId, "client.set-status"),
      addContact: may(deps, actorId, "contact.edit"),
      createOpportunity: may(deps, actorId, "opportunity.create"),
      viewOpportunities,
    },
    statuses: options(CLIENT_STATUS_LABELS),
    services: options(SERVICE_LABELS),
    leadSources: options(LEAD_SOURCE_LABELS),
  });
}

export function opportunityDetail(deps: CrmDeps, actorId: Id | null, opportunityId: Id, today: string): Result<OpportunityDetailView, Refused> {
  if (!may(deps, actorId, "opportunity.view")) return err("forbidden");
  const opportunity = deps.opportunities.get(opportunityId);
  if (!opportunity) return err("not-found");
  const client = deps.clients.get(opportunity.organizationId);
  const contact = opportunity.contactId ? deps.contacts.get(opportunity.contactId) : null;
  const owner = deps.users.accessFor(opportunity.ownerId);
  const project = deps.projects.byOpportunity(opportunityId);
  const viewValue = may(deps, actorId, "opportunity.view-value");
  const next = nextStage(opportunity);
  return ok({
    opportunity: {
      id: opportunity.id,
      title: opportunity.title,
      stage: opportunity.stage,
      stageLabel: STAGE_LABELS[opportunity.stage] ?? opportunity.stage,
      serviceLabel: opportunity.service ? (SERVICE_LABELS[opportunity.service] ?? opportunity.service) : "Not chosen yet",
      leadSourceLabel: LEAD_SOURCE_LABELS[opportunity.leadSource] ?? opportunity.leadSource,
      followUpOn: opportunity.followUpOn ?? "",
      followUpDue: isFollowUpDue(opportunity, today),
      summary: opportunity.summary,
      lostReason: opportunity.lostReason ?? "",
      open: isOpen(opportunity),
      won: opportunity.stage === "won",
      price: viewValue ? (priceLabel(opportunity.pricing, opportunity.value) ?? "") : "",
      pricing: viewValue ? (opportunity.pricing ?? "") : "",
      amount: viewValue && opportunity.value ? (opportunity.value.minor / 100).toFixed(2) : "",
    },
    client: { id: opportunity.organizationId, name: client?.name ?? "" },
    contactName: contact?.name ?? "",
    ownerName: owner?.user.name ?? "",
    nextStage: next ?? "",
    nextStageLabel: next ? (STAGE_LABELS[next] ?? next) : "",
    canSkipToWon: opportunity.service === "landing-page" && opportunity.stage === "consulted",
    project: project ? { id: project.id, name: project.name } : null,
    can: {
      setStage: may(deps, actorId, "opportunity.set-stage"),
      viewValue,
      setValue: may(deps, actorId, "opportunity.set-value"),
      setFollowUp: may(deps, actorId, "opportunity.set-follow-up"),
      convert: may(deps, actorId, "opportunity.convert"),
    },
    pricings: options(PRICING_LABELS),
  });
}

/** Open opportunities whose follow-up is today or earlier, for the dashboard. */
export function followUpsDue(deps: CrmDeps, actorId: Id | null, today: string): Result<FollowUpsView, "forbidden"> {
  if (!may(deps, actorId, "opportunity.view")) return err("forbidden");
  return ok({
    items: deps.opportunities.dueBy(today).map((o) => ({
      id: o.id,
      title: o.title,
      clientName: o.clientName,
      followUpOn: o.followUpOn ?? "",
      overdue: (o.followUpOn ?? "") < today,
    })),
  });
}
