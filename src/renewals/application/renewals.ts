// Renewals: add them to a client, mark them renewed, retire them, and see
// what is coming up. Permissions: the CRM's `client.view` to see and
// `client.edit` to change: a renewal is part of what we know about a client.
import { newRenewal, RENEWAL_KIND_LABELS, renewed, stateOf, TERM_LABELS, TERMS, yearly, type Renewal, type RenewalError, type RenewalInput } from "../domain/renewal.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { dueText, err, formatMoney, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { ClientNames, RenewalStore } from "./ports.ts";

export type RenewalsDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly renewals: RenewalStore;
  readonly clientName: ClientNames;
  readonly today: () => string;
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
};

function lineOf(deps: RenewalsDeps, renewal: Renewal, today: string): RenewalLine {
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
  const lines = all.map((one) => lineOf(deps, one, today));
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

export type ClientRenewalsView = { readonly items: readonly RenewalLine[]; readonly canEdit: boolean; readonly kinds: typeof KIND_OPTIONS; readonly terms: typeof TERM_OPTIONS };

/** A client's renewals, for its page. Permission: `client.view`. */
export function clientRenewals(deps: RenewalsDeps, actorId: Id | null, organizationId: Id): Result<ClientRenewalsView, "forbidden"> {
  if (!allowed(deps, actorId, "client.view")) return err("forbidden");
  const today = deps.today();
  return ok({ items: deps.renewals.listFor(organizationId).map((one) => lineOf(deps, one, today)), canEdit: allowed(deps, actorId, "client.edit"), kinds: KIND_OPTIONS, terms: TERM_OPTIONS });
}

/** Overdue and coming up in 30 days, for the dashboard. Empty without `client.view`. */
export function renewalsComingUp(deps: RenewalsDeps, actorId: Id | null): readonly RenewalLine[] {
  if (!allowed(deps, actorId, "client.view")) return [];
  const today = deps.today();
  return deps.renewals
    .listActive()
    .map((one) => lineOf(deps, one, today))
    .filter((one) => one.state !== "later");
}
