// What the CRM's pages show. Each read checks permission. A deal's price is
// left out entirely for anyone without `opportunity.view-value`.
import { CLIENT_STATUS_LABELS, LEAD_SOURCE_LABELS, options, PRICING_LABELS, priceLabel, SERVICE_LABELS, SIZE_TIER_LABELS, STAGE_LABELS } from "../domain/labels.ts";
import { isClientStatus } from "../domain/client.ts";
import { isFollowUpDue, isOpen, nextStage, STAGES, type Opportunity } from "../domain/opportunity.ts";
import { pipelineNumbers } from "../domain/pipeline-report.ts";
import { authorize } from "../../identity/index.ts";
import { dueText, err, formatMoney, ok, type Id, type Result } from "../../shared/index.ts";
import type { CrmDeps, Refused } from "./commands.ts";

export type Option = { readonly value: string; readonly label: string };

export type ClientListView = {
  /** The status the list is filtered by, or "" for every client. */
  readonly status: string;
  readonly statuses: readonly Option[];
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
  readonly items: readonly { readonly id: string; readonly title: string; readonly clientName: string; readonly followUpOn: string; readonly followUpText: string; readonly overdue: boolean }[];
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

/** Every client, or only those with one status. An unknown status shows every client. */
export function listClients(deps: CrmDeps, actorId: Id | null, filter: { readonly status?: string } = {}): Result<ClientListView, "forbidden"> {
  if (!may(deps, actorId, "client.view")) return err("forbidden");
  const status = filter.status && isClientStatus(filter.status) ? filter.status : "";
  return ok({
    status,
    statuses: options(CLIENT_STATUS_LABELS),
    clients: deps.clients
      .list()
      .filter((client) => status === "" || client.status === status)
      .map((client) => ({
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
      followUpText: o.followUpOn ? dueText(o.followUpOn, today) : "",
      overdue: (o.followUpOn ?? "") < today,
    })),
  });
}

export type PipelineView = {
  readonly columns: readonly {
    readonly stage: string;
    readonly label: string;
    readonly nextStage: string;
    readonly nextStageLabel: string;
    readonly items: readonly {
      readonly id: string;
      readonly title: string;
      readonly clientName: string;
      readonly serviceLabel: string;
      readonly followUpOn: string;
      readonly followUpDue: boolean;
      /** Empty for anyone who may not see deal values. */
      readonly price: string;
    }[];
  }[];
  readonly openCount: number;
  readonly canMove: boolean;
};

/** Open opportunities grouped by stage, oldest first in each. */
export function pipeline(deps: CrmDeps, actorId: Id | null, today: string): Result<PipelineView, "forbidden"> {
  if (!may(deps, actorId, "opportunity.view")) return err("forbidden");
  const showValue = may(deps, actorId, "opportunity.view-value");
  const open = deps.opportunities.listOpen();
  const columns = STAGES.filter((stage) => stage !== "won" && stage !== "lost").map((stage) => {
    const next = STAGES[STAGES.indexOf(stage) + 1] ?? "";
    return {
      stage,
      label: STAGE_LABELS[stage] ?? stage,
      nextStage: next,
      nextStageLabel: STAGE_LABELS[next] ?? next,
      items: open
        .filter((o) => o.stage === stage)
        .map((o) => ({
          id: o.id,
          title: o.title,
          clientName: o.clientName,
          serviceLabel: o.service ? (SERVICE_LABELS[o.service] ?? o.service) : "Not chosen yet",
          followUpOn: o.followUpOn ?? "",
          followUpDue: isFollowUpDue(o, today),
          price: showValue ? (priceLabel(o.pricing, o.value) ?? "") : "",
        })),
    };
  });
  return ok({ columns, openCount: open.length, canMove: may(deps, actorId, "opportunity.set-stage") });
}

export type PipelineReportView = {
  readonly days: number;
  readonly periods: readonly { readonly value: number; readonly label: string }[];
  readonly stages: readonly { readonly label: string; readonly count: number; readonly fixed: string }[];
  readonly open: number;
  readonly won: number;
  readonly lost: number;
  readonly winRate: string;
  readonly wonFixed: string;
  readonly sources: readonly { readonly label: string; readonly count: number; readonly won: number }[];
};

const REPORT_PERIODS = [30, 90, 365] as const;

/**
 * The pipeline report. Permission: `report.view`, and `opportunity.view-value`
 * because it adds up quotes.
 */
export function pipelineReport(deps: CrmDeps, actorId: Id | null, today: string, days: number): Result<PipelineReportView, "forbidden"> {
  if (!may(deps, actorId, "report.view") || !may(deps, actorId, "opportunity.view-value")) return err("forbidden");
  const period = (REPORT_PERIODS as readonly number[]).includes(days) ? days : 90;
  const since = `${Temporal.PlainDate.from(today).subtract({ days: period }).toString()}T00:00:00Z`;
  const numbers = pipelineNumbers(deps.opportunities.listAll(), since);
  const dollars = (minor: number) => formatMoney({ minor, currency: "USD" });
  return ok({
    days: period,
    periods: REPORT_PERIODS.map((value) => ({ value, label: value === 365 ? "The last year" : `The last ${value} days` })),
    stages: numbers.stages.map((row) => ({ label: STAGE_LABELS[row.stage] ?? row.stage, count: row.count, fixed: dollars(row.fixedMinor) })),
    open: numbers.open,
    won: numbers.won,
    lost: numbers.lost,
    winRate: numbers.winRate === null ? "Nothing closed" : `${numbers.winRate}%`,
    wonFixed: dollars(numbers.wonFixedMinor),
    sources: numbers.sources.map((row) => ({ label: LEAD_SOURCE_LABELS[row.source] ?? row.source, count: row.count, won: row.won })),
  });
}
