// Renewals: add them to a client, mark them renewed, retire them, bill the
// client for one, and see what is coming up. Permissions: the CRM's
// `client.view` to see and `client.edit` to change: a renewal is part of what
// we know about a client. Billing also needs `invoice.edit`.
//
// A client pays for a renewal a week before it renews (PAY_AHEAD_DAYS), so
// Potomac knows in time whether to renew it or let it lapse.
import { billed, billedThisTerm, billFor, newRenewal, payBy, PAY_AHEAD_DAYS, RENEWAL_KIND_LABELS, renewed, stateOf, TERM_LABELS, TERMS, yearly, type BillError, type Renewal, type RenewalError, type RenewalInput } from "../domain/renewal.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { dueText, err, formatMoney, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { BilledInvoice, ClientNames, RenewalBilling, RenewalStore } from "./ports.ts";

export type RenewalsDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly renewals: RenewalStore;
  readonly clientName: ClientNames;
  readonly today: () => string;
  readonly billing: RenewalBilling;
};

type Refused = "forbidden" | "not-found";
const allowed = (deps: RenewalsDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;
const usd = (minor: number) => formatMoney({ minor, currency: "USD" });

export function addRenewal(deps: RenewalsDeps, actorId: Id | null, organizationId: Id, input: RenewalInput): Result<Renewal, Refused | RenewalError> {
  if (!allowed(deps, actorId, "client.edit")) return err("forbidden");
  return deps.transact(() => {
    if (deps.clientName(organizationId) === null) return err("not-found");
    const made = newRenewal({ id: deps.newId(), organizationId }, input);
    if (!made.ok) return made;
    deps.renewals.insert(made.value, deps.clock());
    recordActivity(deps, { actorId, action: "renewal.added", recordType: "renewal", recordId: made.value.id, context: { organizationId, kind: made.value.kind, renewsOn: made.value.renewsOn } });
    return ok(made.value);
  });
}

/** It was renewed: its date moves on a term. */
export function markRenewed(deps: RenewalsDeps, actorId: Id | null, id: Id): Result<Renewal, Refused> {
  if (!allowed(deps, actorId, "client.edit")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.renewals.get(id);
    if (!found || !found.active) return err("not-found");
    const next = renewed(found);
    deps.renewals.update(next, deps.clock());
    recordActivity(deps, { actorId, action: "renewal.renewed", recordType: "renewal", recordId: id, context: { organizationId: found.organizationId, from: found.renewsOn, to: next.renewsOn } });
    return ok(next);
  });
}

/** No longer kept: let lapse, moved elsewhere, or not ours to watch. */
export function retireRenewal(deps: RenewalsDeps, actorId: Id | null, id: Id): Result<Renewal, Refused> {
  if (!allowed(deps, actorId, "client.edit")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.renewals.get(id);
    if (!found || !found.active) return err("not-found");
    const gone = { ...found, active: false };
    deps.renewals.update(gone, deps.clock());
    recordActivity(deps, { actorId, action: "renewal.retired", recordType: "renewal", recordId: id, context: { organizationId: found.organizationId, kind: found.kind } });
    return ok(gone);
  });
}

/**
 * Bills the client for a renewal's coming term: an invoice with one line,
 * sent, on one of their projects, due a week before it renews. Once a term.
 * Permissions: `client.edit` and `invoice.edit`.
 */
export function billRenewal(deps: RenewalsDeps, actorId: Id | null, id: Id, input: { readonly projectId: string }): Result<Renewal, Refused | BillError | "project-missing"> {
  if (!allowed(deps, actorId, "client.edit") || !deps.billing.mayBill(actorId)) return err("forbidden");
  const found = deps.renewals.get(id);
  if (!found || !found.active) return err("not-found");
  const project = deps.billing.projectsFor(found.organizationId).find((one) => one.id === input.projectId);
  if (!project) return err("project-missing");
  const bill = billFor(found, deps.today());
  if (!bill.ok) return bill;
  // Finance makes and sends the invoice in its own transactions; then the renewal records it.
  const sent = deps.billing.send(actorId, found.organizationId, project.id, bill.value);
  if (!sent.ok) return sent;
  return deps.transact(() => {
    const current = deps.renewals.get(id) ?? found;
    const next = billed(current, sent.value.id);
    deps.renewals.update(next, deps.clock());
    recordActivity(deps, { actorId, action: "renewal.billed", recordType: "renewal", recordId: id, context: { organizationId: found.organizationId, invoiceId: sent.value.id, renewsOn: found.renewsOn, dueOn: bill.value.dueOn, minor: bill.value.amount.minor } });
    return ok(next);
  });
}

/** Where a renewal's coming term stands with the client. */
export type BillState = "not-billed" | "billed" | "paid" | "late" | "ours";

function billState(deps: RenewalsDeps, renewal: Renewal, today: string): { readonly state: BillState; readonly invoice: BilledInvoice | null } {
  if (!renewal.price || renewal.price.minor <= 0) return { state: "ours", invoice: null };
  const invoice = billedThisTerm(renewal) && renewal.invoiceId ? deps.billing.invoice(renewal.invoiceId) : null;
  if (!invoice || invoice.status === "void" || invoice.status === "draft") return { state: "not-billed", invoice: null };
  if (invoice.status === "paid" || invoice.owedMinor <= 0) return { state: "paid", invoice };
  return { state: Temporal.PlainDate.compare(today, payBy(renewal)) > 0 ? "late" : "billed", invoice };
}

const longDay = (date: string) => Temporal.PlainDate.from(date).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" });

export type RenewalLine = {
  readonly id: string;
  readonly organizationId: string;
  readonly clientName: string;
  readonly kindLabel: string;
  readonly name: string;
  readonly provider: string;
  readonly renewsOn: string;
  readonly when: string;
  readonly state: "overdue" | "soon" | "later";
  readonly termLabel: string;
  readonly cost: string;
  readonly price: string;
  readonly autoRenews: boolean;
  readonly note: string;
  /** The day the client pays by: a week before it renews. */
  readonly payBy: string;
  readonly billState: BillState;
  /** "INV-0012 sent, due Tuesday, November 25", in a sentence. Empty when it isn't billed to the client. */
  readonly billing: string;
  readonly invoiceId: string;
  /** True when it can be billed now: Potomac bills it, this term isn't billed, and the actor may. */
  readonly canBill: boolean;
};

function lineOf(deps: RenewalsDeps, renewal: Renewal, today: string, actorId: Id | null = null): RenewalLine {
  const { state, invoice } = billState(deps, renewal, today);
  const due = longDay(payBy(renewal));
  const billing =
    state === "ours" ? ""
    : state === "not-billed" ? `Not billed yet. The client pays by ${due}, a week before it renews.`
    : state === "paid" ? `${invoice?.label ?? "The invoice"} is paid. Renew it.`
    : state === "late" ? `${invoice?.label ?? "The invoice"} wasn’t paid by ${due}. Decide whether to renew it or let it lapse.`
    : `${invoice?.label ?? "The invoice"} sent. The client pays by ${due}.`;
  return {
    id: renewal.id,
    organizationId: renewal.organizationId,
    clientName: deps.clientName(renewal.organizationId) ?? "A removed client",
    kindLabel: RENEWAL_KIND_LABELS[renewal.kind],
    name: renewal.name,
    provider: renewal.provider,
    renewsOn: renewal.renewsOn,
    when: dueText(renewal.renewsOn, today),
    state: stateOf(renewal, today),
    termLabel: TERM_LABELS[renewal.termMonths] ?? `Every ${renewal.termMonths} months`,
    cost: renewal.cost ? formatMoney(renewal.cost) : "",
    price: renewal.price ? formatMoney(renewal.price) : "",
    autoRenews: renewal.autoRenews,
    note: renewal.note,
    payBy: payBy(renewal),
    billState: state,
    billing,
    invoiceId: invoice?.id ?? "",
    canBill: state === "not-billed" && actorId !== null && allowed(deps, actorId, "client.edit") && deps.billing.mayBill(actorId),
  };
}

const KIND_OPTIONS = Object.entries(RENEWAL_KIND_LABELS).map(([value, label]) => ({ value, label }));
const TERM_OPTIONS = TERMS.map((months) => ({ value: String(months), label: TERM_LABELS[months] ?? "" }));

export type RenewalsView = {
  readonly overdue: readonly RenewalLine[];
  readonly soon: readonly RenewalLine[];
  readonly later: readonly RenewalLine[];
  readonly yearlyCost: string;
  readonly yearlyBilled: string;
  readonly canEdit: boolean;
};

/** Every active renewal, by how soon. Permission: `client.view`. */
export function allRenewals(deps: RenewalsDeps, actorId: Id | null): Result<RenewalsView, "forbidden"> {
  if (!allowed(deps, actorId, "client.view")) return err("forbidden");
  const today = deps.today();
  const all = deps.renewals.listActive();
  const lines = all.map((one) => lineOf(deps, one, today, actorId));
  const totals = all.reduce((sum, one) => ({ cost: sum.cost + yearly(one).cost, price: sum.price + yearly(one).price }), { cost: 0, price: 0 });
  return ok({
    overdue: lines.filter((one) => one.state === "overdue"),
    soon: lines.filter((one) => one.state === "soon"),
    later: lines.filter((one) => one.state === "later"),
    yearlyCost: usd(totals.cost),
    yearlyBilled: usd(totals.price),
    canEdit: allowed(deps, actorId, "client.edit"),
  });
}

export type ClientRenewalsView = { readonly items: readonly RenewalLine[]; readonly canEdit: boolean; readonly kinds: typeof KIND_OPTIONS; readonly terms: typeof TERM_OPTIONS; readonly projects: readonly { readonly value: string; readonly label: string }[] };

/** A client's renewals, for its page. Permission: `client.view`. */
export function clientRenewals(deps: RenewalsDeps, actorId: Id | null, organizationId: Id): Result<ClientRenewalsView, "forbidden"> {
  if (!allowed(deps, actorId, "client.view")) return err("forbidden");
  const today = deps.today();
  return ok({ items: deps.renewals.listFor(organizationId).map((one) => lineOf(deps, one, today, actorId)), canEdit: allowed(deps, actorId, "client.edit"), kinds: KIND_OPTIONS, terms: TERM_OPTIONS, projects: deps.billing.projectsFor(organizationId).map((one) => ({ value: one.id, label: one.name })) });
}

/** Overdue and coming up in 30 days, for the dashboard. Empty without `client.view`. */
export function renewalsComingUp(deps: RenewalsDeps, actorId: Id | null): readonly RenewalLine[] {
  if (!allowed(deps, actorId, "client.view")) return [];
  const today = deps.today();
  return deps.renewals
    .listActive()
    .map((one) => lineOf(deps, one, today, actorId))
    .filter((one) => one.state !== "later");
}

/** A renewal as the client sees it in their portal: what it is, when it renews, what it costs them, and whether it's paid. */
export type PortalRenewalLine = {
  readonly id: string;
  readonly name: string;
  readonly kindLabel: string;
  readonly renewsOn: string;
  readonly renews: string;
  readonly price: string;
  readonly payBy: string;
  readonly state: "not-billed" | "billed" | "paid" | "late";
  /** What to do, in a sentence. */
  readonly say: string;
  /** True when it's billed and not paid: a thing waiting on them. */
  readonly owing: boolean;
};

/** How far ahead the portal shows a renewal coming: about two months. */
export const PORTAL_AHEAD_DAYS = 60;

/**
 * A client's renewals that Potomac bills them for, for their portal: those
 * renewing in the next two months, and any billed and not yet paid. The
 * organization comes from the client's session, never from what they send.
 */
export function portalRenewals(deps: RenewalsDeps, organizationId: Id): readonly PortalRenewalLine[] {
  const today = deps.today();
  return deps.renewals.listFor(organizationId).flatMap((renewal) => {
    const { state, invoice } = billState(deps, renewal, today);
    if (state === "ours") return [];
    const days = Temporal.PlainDate.from(today).until(renewal.renewsOn).days;
    const owing = state === "billed" || state === "late";
    if (days > PORTAL_AHEAD_DAYS && !owing) return [];
    const due = longDay(payBy(renewal));
    const say =
      state === "paid" ? "Paid, thank you. We’ll renew it before it runs out."
      : state === "late" ? `We asked for payment by ${due}, a week before it renews, so we know to renew it. Please pay ${invoice?.label ?? "the invoice"} as soon as you can, or tell us if you’d like to let it go.`
      : state === "billed" ? `Please pay ${invoice?.label ?? "the invoice"} by ${due}, a week before it renews, so we know to renew it.`
      : `We’ll send the bill. It’s due ${due}, a week before it renews.`;
    return [{ id: renewal.id, name: renewal.name, kindLabel: RENEWAL_KIND_LABELS[renewal.kind], renewsOn: renewal.renewsOn, renews: longDay(renewal.renewsOn), price: renewal.price ? formatMoney(renewal.price) : "", payBy: payBy(renewal), state, say, owing }];
  });
}

export { PAY_AHEAD_DAYS };
