// What the proposal pages show. A proposal is all prices, so every read here
// needs `proposal.view`, which a member does not hold.
import { depositFor, formatQuantity, summarize, type EstimateLine } from "../domain/estimate.ts";
import { DECISION_METHODS, isOpenProposal, sectionBlocks, type Proposal, type ProposalContent, type ProposalVersion } from "../domain/proposal.ts";
import { TEMPLATE_OPTIONS, TEMPLATES } from "../domain/templates.ts";
import { authorize } from "../../identity/index.ts";
import { formatHours } from "../../projects/index.ts";
import { err, formatMoney, ok, type Id, type Money, type Result } from "../../shared/index.ts";
import type { ProposalsDeps, Refused } from "./commands.ts";

export type Option = { readonly value: string; readonly label: string };

export const PROPOSAL_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: "Draft",
  sent: "Sent, waiting for an answer",
  revised: "Changed since it was sent",
  accepted: "Accepted",
  declined: "Declined",
};
const PRICING_LABELS: Readonly<Record<string, string>> = { free: "Free", hourly: "Hourly", fixed: "Fixed price", monthly: "Monthly", yearly: "Yearly" };
const METHOD_LABELS: Readonly<Record<string, string>> = { "in-person": "In person", phone: "By phone", email: "By email", "signed-paper": "Signed on paper", portal: "In the client portal" };
const KIND_LABELS: Readonly<Record<string, string>> = { hours: "Hours", quantity: "Quantity" };

const may = (deps: ProposalsDeps, actorId: Id | null, action: string): boolean => actorId !== null && authorize(deps, actorId, action).ok;

/** "$2,400.00", "$50.00 a month", "Free". */
function priceWords(pricing: string, total: Money): string {
  if (pricing === "free") return "Free";
  const amount = formatMoney(total);
  if (pricing === "monthly") return `${amount} a month`;
  if (pricing === "yearly") return `${amount} a year`;
  return amount;
}

export type LineView = { readonly item: string; readonly kind: string; readonly quantity: string; readonly quantityLabel: string; readonly rate: string; readonly total: string };

const lineView = (line: EstimateLine): LineView => ({
  item: line.item,
  kind: line.kind,
  quantity: formatQuantity(line.quantity),
  quantityLabel: line.kind === "hours" ? `${formatQuantity(line.quantity)} h` : formatQuantity(line.quantity),
  rate: formatMoney(line.rate),
  total: formatMoney(line.total),
});

export type SummaryView = { readonly total: string; readonly price: string; readonly hours: string; readonly deposit: string; readonly balance: string; readonly pricingLabel: string };

function summaryView(content: Pick<ProposalContent, "pricing" | "lines">): SummaryView {
  const { total, minutes } = summarize(content.lines);
  const deposit = depositFor(content.pricing, total);
  return {
    total: formatMoney(total),
    price: priceWords(content.pricing, total),
    hours: minutes > 0 ? formatHours(minutes) : "",
    deposit: deposit ? formatMoney(deposit) : "",
    balance: deposit ? formatMoney({ minor: total.minor - deposit.minor, currency: total.currency }) : "",
    pricingLabel: PRICING_LABELS[content.pricing] ?? content.pricing,
  };
}

export type OpportunityProposalsView = {
  readonly canView: boolean;
  readonly canStart: boolean;
  readonly templates: readonly Option[];
  /** The template that fits the opportunity's service, or "blank". */
  readonly suggested: string;
  readonly items: readonly { readonly id: string; readonly title: string; readonly statusLabel: string; readonly version: number; readonly price: string }[];
};

/** An opportunity's proposals, for its page. Without `proposal.view` the panel is simply not shown. */
export function proposalsFor(deps: ProposalsDeps, actorId: Id | null, opportunityId: Id): OpportunityProposalsView {
  if (!may(deps, actorId, "proposal.view")) return { canView: false, canStart: false, templates: [], suggested: "blank", items: [] };
  const opportunity = deps.opportunities.get(opportunityId);
  const open = opportunity !== null && opportunity.stage !== "won" && opportunity.stage !== "lost";
  return {
    canView: true,
    canStart: open && may(deps, actorId, "proposal.edit"),
    templates: TEMPLATE_OPTIONS,
    suggested: opportunity?.service && Object.hasOwn(TEMPLATES, opportunity.service) ? opportunity.service : "blank",
    items: deps.proposals.listFor(opportunityId).map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      statusLabel: PROPOSAL_STATUS_LABELS[proposal.status] ?? proposal.status,
      version: proposal.currentVersion,
      price: priceWords(proposal.pricing, summarize(proposal.lines).total),
    })),
  };
}

export type ProposalListView = {
  readonly proposals: readonly { readonly id: string; readonly title: string; readonly clientName: string; readonly status: string; readonly statusLabel: string; readonly version: number; readonly price: string }[];
};

export function listProposals(deps: ProposalsDeps, actorId: Id | null): Result<ProposalListView, "forbidden"> {
  if (!may(deps, actorId, "proposal.view")) return err("forbidden");
  return ok({
    proposals: deps.proposals.list().map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      clientName: proposal.clientName,
      status: proposal.status,
      statusLabel: PROPOSAL_STATUS_LABELS[proposal.status] ?? proposal.status,
      version: proposal.currentVersion,
      price: priceWords(proposal.pricing, summarize(proposal.lines).total),
    })),
  });
}

/** How many empty rows the estimate form offers below the lines already there. */
const SPARE_ROWS = 3;

export type ProposalDetailView = {
  readonly proposal: {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly statusLabel: string;
    readonly pricing: string;
    readonly scope: string;
    readonly assumptions: string;
    readonly exclusions: string;
    readonly deliverables: string;
    readonly currentVersion: number;
    readonly open: boolean;
    readonly shared: boolean;
  };
  readonly opportunity: { readonly id: string; readonly title: string; readonly stage: string };
  readonly client: { readonly id: string; readonly name: string };
  /** The form's rows: each line, then a few empty ones. */
  readonly rows: readonly { readonly index: number; readonly item: string; readonly kind: string; readonly quantity: string; readonly rate: string; readonly total: string }[];
  readonly summary: SummaryView;
  readonly versions: readonly { readonly number: number; readonly sentWhen: string; readonly sentBy: string; readonly price: string; readonly current: boolean }[];
  readonly decision: { readonly accepted: boolean; readonly version: number; readonly byName: string; readonly on: string; readonly methodLabel: string; readonly note: string } | null;
  readonly project: { readonly id: string; readonly name: string } | null;
  readonly agreements: readonly { readonly id: string; readonly reference: string; readonly signedOn: string; readonly version: number; readonly fileId: string; readonly fileName: string }[];
  readonly can: { readonly edit: boolean; readonly send: boolean; readonly decide: boolean; readonly recordAgreement: boolean; readonly share: boolean; readonly download: boolean };
  /** Why it cannot be sent yet, in words, or "". */
  readonly sendBlocked: string;
  readonly pricings: readonly Option[];
  readonly kinds: readonly Option[];
  readonly methods: readonly Option[];
  readonly today: string;
};

const options = (labels: Readonly<Record<string, string>>): Option[] => Object.entries(labels).map(([value, label]) => ({ value, label }));

export function proposalDetail(deps: ProposalsDeps, actorId: Id | null, proposalId: Id): Result<ProposalDetailView, Refused> {
  if (!may(deps, actorId, "proposal.view")) return err("forbidden");
  const proposal = deps.proposals.get(proposalId);
  const opportunity = proposal ? deps.opportunities.get(proposal.opportunityId) : null;
  if (!proposal || !opportunity) return err("not-found");
  const client = deps.clients.get(opportunity.organizationId);
  const open = isOpenProposal(proposal);
  const decision = deps.proposals.decision(proposalId);
  const project = deps.projects.byOpportunity(opportunity.id);
  const names = new Map(deps.users.list().map((user) => [user.id as string, user.name]));
  const stageOk = opportunity.stage === "consulted" || opportunity.stage === "quoted";
  const filled = proposal.lines.map((line, index) => ({ index, ...lineView(line), rate: (line.rate.minor / 100).toFixed(2) }));
  const spare = Array.from({ length: SPARE_ROWS }, (_, i) => ({ index: filled.length + i, item: "", kind: "hours", quantity: "", rate: "", total: "" }));
  return ok({
    proposal: {
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      statusLabel: PROPOSAL_STATUS_LABELS[proposal.status] ?? proposal.status,
      pricing: proposal.pricing,
      scope: proposal.scope,
      assumptions: proposal.assumptions,
      exclusions: proposal.exclusions,
      deliverables: proposal.deliverables,
      currentVersion: proposal.currentVersion,
      open,
      shared: proposal.sharedWithClient,
    },
    opportunity: { id: opportunity.id, title: opportunity.title, stage: opportunity.stage },
    client: { id: opportunity.organizationId, name: client?.name ?? "" },
    rows: open ? [...filled, ...spare] : filled,
    summary: summaryView(proposal),
    versions: deps.proposals.versions(proposalId).map((version) => ({
      number: version.number,
      sentWhen: deps.formatWhen(version.sentAt),
      sentBy: names.get(version.sentBy) ?? "",
      price: priceWords(version.pricing, version.total),
      current: version.number === proposal.currentVersion,
    })),
    decision: decision
      ? { accepted: decision.decision === "accepted", version: decision.version, byName: decision.byName, on: decision.on, methodLabel: METHOD_LABELS[decision.method] ?? decision.method, note: decision.note ?? "" }
      : null,
    project: project ? { id: project.id, name: project.name } : null,
    agreements: deps.proposals.agreements(proposalId).map((agreement) => ({ id: agreement.id, reference: agreement.reference, signedOn: agreement.signedOn, version: agreement.version, fileId: agreement.fileId ?? "", fileName: agreement.fileName ?? "" })),
    can: {
      edit: open && may(deps, actorId, "proposal.edit"),
      send: open && proposal.status !== "sent" && stageOk && may(deps, actorId, "proposal.send"),
      decide: proposal.status === "sent" && may(deps, actorId, "proposal.decide"),
      recordAgreement: proposal.status === "accepted" && may(deps, actorId, "proposal.decide"),
      share: proposal.currentVersion > 0 && may(deps, actorId, "proposal.send"),
      download: may(deps, actorId, "file.download"),
    },
    sendBlocked:
      !open || proposal.status === "sent"
        ? ""
        : opportunity.stage === "won" || opportunity.stage === "lost"
          ? "The opportunity is closed, so this proposal cannot be sent."
          : stageOk
            ? ""
            : "Move the opportunity to Consulted before sending a proposal.",
    pricings: options(PRICING_LABELS),
    kinds: options(KIND_LABELS),
    methods: DECISION_METHODS.filter((method) => method !== "portal").map((method) => ({ value: method, label: METHOD_LABELS[method] ?? method })),
    today: deps.today(),
  });
}

/** A sent version laid out for reading, printing and the PDF. */
export type ProposalDocument = {
  readonly proposalId: string;
  readonly number: number;
  readonly title: string;
  readonly clientName: string;
  readonly contactName: string;
  readonly sentWhen: string;
  readonly sentBy: string;
  readonly sections: readonly { readonly heading: string; readonly blocks: readonly { readonly key: string; readonly bullet: boolean; readonly text: string }[] }[];
  readonly lines: readonly (LineView & { readonly key: string })[];
  readonly summary: SummaryView;
  /** A name for the downloaded file, such as "Bakery-website-proposal-v2.pdf". */
  readonly fileName: string;
};

export function documentFor(deps: ProposalsDeps, proposal: Proposal, version: ProposalVersion): ProposalDocument {
  const opportunity = deps.opportunities.get(proposal.opportunityId);
  const client = opportunity ? deps.clients.get(opportunity.organizationId) : null;
  const contact = opportunity?.contactId ? deps.contacts.get(opportunity.contactId) : opportunity ? (deps.contacts.listFor(opportunity.organizationId).find((one) => one.isPrimary) ?? null) : null;
  const sections = [
    { heading: "Scope", text: version.scope },
    { heading: "Deliverables", text: version.deliverables },
    { heading: "Assumptions", text: version.assumptions },
    { heading: "Not included", text: version.exclusions },
  ];
  const slug = version.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "proposal";
  return {
    proposalId: proposal.id,
    number: version.number,
    title: version.title,
    clientName: client?.name ?? "",
    contactName: contact?.name ?? "",
    sentWhen: deps.formatWhen(version.sentAt),
    sentBy: deps.users.get(version.sentBy)?.name ?? "",
    sections: sections.map((section) => ({ heading: section.heading, blocks: sectionBlocks(section.text).map((block, index) => ({ key: String(index), ...block })) })).filter((section) => section.blocks.length > 0),
    lines: version.lines.map((line, index) => ({ key: String(index), ...lineView(line) })),
    summary: summaryView(version),
    fileName: `${slug}-proposal-v${version.number}.pdf`,
  };
}

export function proposalVersion(deps: ProposalsDeps, actorId: Id | null, proposalId: Id, number: number): Result<ProposalDocument, Refused> {
  if (!may(deps, actorId, "proposal.view")) return err("forbidden");
  const proposal = deps.proposals.get(proposalId);
  const version = proposal && Number.isInteger(number) ? deps.proposals.version(proposalId, number) : null;
  if (!proposal || !version) return err("not-found");
  return ok(documentFor(deps, proposal, version));
}
