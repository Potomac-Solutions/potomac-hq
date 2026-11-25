// Thanking the person who sent them (decision 0010, section 7). An
// opportunity can say who referred it: a client, picked, or a person, typed
// in. A client can have their own referral link; a lead that comes by it is
// marked as theirs. When a referred client pays their first invoice, the
// client who referred them earns a credit, taken off one of their own draft
// invoices when someone applies it.
import { codeFor, creditToApply, DEFAULT_CREDIT_MINOR, referrerName } from "../domain/credit.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, formatMoney, ok, parseAmount, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { ReferralCreditStore } from "./ports.ts";

export type ReferralCreditDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly store: ReferralCreditStore;
  readonly formatWhen: (instant: string) => string;
  readonly clientName: (organizationId: Id) => string | null;
  readonly opportunityExists: (id: Id) => boolean;
  /** Makes a referral link, through the referral links module. */
  readonly makeLink: (actorId: Id, input: { readonly code: string; readonly label: string; readonly destination: string }) => Result<{ readonly id: Id; readonly code: string }, string>;
  /** Takes a credit off a draft invoice, through finance. */
  readonly applyCredit: (actorId: Id, invoiceId: Id, minor: number) => Result<unknown, string>;
  /** potomac.solutions, where a client's link sends their friends. */
  readonly siteUrl: string;
  /** Clients to pick a referrer from, by name. */
  readonly clientOptions: () => readonly { readonly id: Id; readonly name: string }[];
};

type Refused = "forbidden" | "not-found";
const may = (deps: ReferralCreditDeps, actorId: Id | null, permission: string): actorId is Id => actorId !== null && authorize(deps, actorId, permission).ok;
const dollars = (minor: number) => formatMoney({ minor, currency: "USD" });

/** Says who referred an opportunity: a client, or a person's name, or nobody. */
export function setReferredBy(deps: ReferralCreditDeps, actorId: Id | null, opportunityId: Id, input: { readonly organizationId: string; readonly name: string }): Result<null, Refused | "name-too-long" | "self-referral"> {
  if (!may(deps, actorId, "opportunity.edit")) return err("forbidden");
  const name = referrerName(input.name);
  if (!name.ok) return name;
  return deps.transact(() => {
    const current = deps.store.referredBy(opportunityId);
    if (!current || !deps.opportunityExists(opportunityId)) return err("not-found");
    const orgText = input.organizationId.trim();
    const organizationId = orgText === "" ? null : (orgText as Id);
    if (organizationId !== null && deps.clientName(organizationId) === null) return err("not-found");
    if (organizationId !== null && organizationId === current.clientId) return err("self-referral");
    deps.store.setReferredBy(opportunityId, { organizationId, name: organizationId ? null : name.value }, deps.clock());
    recordActivity(deps, { actorId, action: "opportunity.referred-by-set", recordType: "opportunity", recordId: opportunityId, context: { organizationId, name: organizationId ? null : name.value } });
    return ok(null);
  });
}

/**
 * An inquiry or booking came by a referral link. If the link is a client's
 * own, the opportunity is marked as referred by them, unless someone already
 * said who. HQ does this by itself, as the lead arrives.
 */
export function markReferredByLink(deps: ReferralCreditDeps, opportunityId: Id): boolean {
  return deps.transact(() => {
    const owner = deps.store.linkOwnerFor(opportunityId);
    const current = deps.store.referredBy(opportunityId);
    if (!owner || !current || current.organizationId || current.name) return false;
    deps.store.setReferredBy(opportunityId, { organizationId: owner, name: null }, deps.clock());
    recordActivity(deps, { actorId: null, action: "opportunity.referred-by-set", recordType: "opportunity", recordId: opportunityId, context: { organizationId: owner, by: "link" } });
    return true;
  });
}

/** Makes a client their own referral link, to give to friends. One each. */
export function makeClientLink(deps: ReferralCreditDeps, actorId: Id | null, organizationId: Id): Result<{ readonly code: string }, Refused | "already-has-one" | "link-failed"> {
  if (!may(deps, actorId, "referral.manage")) return err("forbidden");
  const name = deps.clientName(organizationId);
  if (name === null) return err("not-found");
  if (deps.store.linkFor(organizationId)) return err("already-has-one");
  const base = codeFor(name);
  // The code is printed and shared, so it's the client's name; a clash gets a number.
  for (let n = 0; n < 20; n++) {
    const code = n === 0 ? base : `${base}-${n + 1}`;
    const made = deps.makeLink(actorId, { code, label: `${name}’s own link`, destination: deps.siteUrl });
    if (made.ok) {
      deps.transact(() => {
        deps.store.setLinkOwner(made.value.id, organizationId);
        recordActivity(deps, { actorId, action: "referral-link.given-to-client", recordType: "client-organization", recordId: organizationId, context: { code: made.value.code } });
      });
      return ok({ code: made.value.code });
    }
    if (made.error !== "code-taken") return err(made.error === "forbidden" ? "forbidden" : "link-failed");
  }
  return err("link-failed");
}

/**
 * Gives each credit that's come due: a referred client has paid an invoice.
 * One credit for each client referred, at what a referral is worth then.
 * Run every few minutes; it does nothing when nothing is due.
 */
export function earnCredits(deps: ReferralCreditDeps): number {
  return deps.transact(() => {
    const due = deps.store.creditsDue();
    const minor = deps.store.creditMinor() ?? DEFAULT_CREDIT_MINOR;
    for (const one of due) {
      const id = deps.newId();
      deps.store.addCredit({ id, referrerId: one.referrerId, referredId: one.referredId, minor, at: deps.clock() });
      recordActivity(deps, { actorId: null, action: "referral-credit.earned", recordType: "client-organization", recordId: one.referrerId, context: { referredId: one.referredId, minor } });
    }
    return due.length;
  });
}

export type ClientReferralsView = {
  readonly organizationId: string;
  readonly link: { readonly code: string; readonly address: string } | null;
  readonly canMakeLink: boolean;
  readonly referred: readonly { readonly opportunityId: string; readonly title: string; readonly clientId: string; readonly clientName: string; readonly when: string; readonly credited: boolean }[];
  readonly earned: string;
  readonly used: string;
  readonly available: string;
  readonly availableMinor: number;
  readonly creditEach: string;
};

/** A client's referrals and credit, for their page; null for someone who may not see clients. */
export function clientReferrals(deps: ReferralCreditDeps, actorId: Id | null, organizationId: Id, publicUrl: string): ClientReferralsView | null {
  if (!may(deps, actorId, "client.view") || deps.clientName(organizationId) === null) return null;
  return referralsOf(deps, organizationId, publicUrl, may(deps, actorId, "referral.manage"));
}

function referralsOf(deps: ReferralCreditDeps, organizationId: Id, publicUrl: string, canMakeLink: boolean): ClientReferralsView {
  const link = deps.store.linkFor(organizationId);
  const credited = new Set(deps.store.credits(organizationId).map((one) => one.referredId));
  const earned = deps.store.earnedMinor(organizationId);
  const used = deps.store.usedMinor(organizationId);
  return {
    organizationId,
    link: link ? { code: link.code, address: `${publicUrl}/r/${link.code}` } : null,
    canMakeLink: canMakeLink && !link,
    referred: deps.store.referredByClient(organizationId).map((one) => ({ opportunityId: one.opportunityId, title: one.title, clientId: one.clientId, clientName: deps.clientName(one.clientId) ?? "", when: deps.formatWhen(one.createdAt), credited: credited.has(one.clientId) })),
    earned: dollars(earned),
    used: dollars(used),
    available: dollars(Math.max(0, earned - used)),
    availableMinor: Math.max(0, earned - used),
    creditEach: dollars(deps.store.creditMinor() ?? DEFAULT_CREDIT_MINOR),
  };
}

/** The signed-in client's own link and credit, for the portal. */
export function portalReferrals(deps: ReferralCreditDeps, organizationId: Id | null, publicUrl: string): ClientReferralsView | null {
  return organizationId ? referralsOf(deps, organizationId, publicUrl, false) : null;
}

/** What credit a draft invoice could take, for its page. */
export function creditFor(deps: ReferralCreditDeps, actorId: Id | null, invoiceId: Id): { readonly available: string; readonly applies: string } | null {
  if (!may(deps, actorId, "invoice.edit")) return null;
  const invoice = deps.store.invoice(invoiceId);
  if (!invoice || invoice.status !== "draft") return null;
  const available = Math.max(0, deps.store.earnedMinor(invoice.organizationId) - deps.store.usedMinor(invoice.organizationId));
  const applies = creditToApply(available, invoice.totalMinor);
  return applies > 0 ? { available: dollars(available), applies: dollars(applies) } : null;
}

/** Takes a client's referral credit off one of their draft invoices: what's available, up to all but its last dollar. */
export function applyReferralCredit(deps: ReferralCreditDeps, actorId: Id | null, invoiceId: Id): Result<{ readonly applied: string }, Refused | "no-credit" | "not-a-draft"> {
  if (!may(deps, actorId, "invoice.edit")) return err("forbidden");
  const invoice = deps.store.invoice(invoiceId);
  if (!invoice) return err("not-found");
  if (invoice.status !== "draft") return err("not-a-draft");
  const useId = deps.newId();
  // Counted as used first, so two presses can't spend it twice; given back if the invoice refuses it.
  const minor = deps.transact(() => {
    const available = Math.max(0, deps.store.earnedMinor(invoice.organizationId) - deps.store.usedMinor(invoice.organizationId));
    const amount = creditToApply(available, invoice.totalMinor);
    if (amount > 0) deps.store.addUse({ id: useId, referrerId: invoice.organizationId, invoiceId, minor: amount, userId: actorId, at: deps.clock() });
    return amount;
  });
  if (minor === 0) return err("no-credit");
  const applied = deps.applyCredit(actorId, invoiceId, minor);
  if (!applied.ok) {
    deps.transact(() => deps.store.removeUse(useId));
    return err(applied.error === "not-a-draft" ? "not-a-draft" : applied.error === "forbidden" ? "forbidden" : "no-credit");
  }
  return ok({ applied: dollars(minor) });
}

/** Sets what each referral earns, from now on. */
export function setCreditAmount(deps: ReferralCreditDeps, actorId: Id | null, typed: string): Result<{ readonly amount: string }, "forbidden" | "amount-invalid"> {
  if (!may(deps, actorId, "referral.manage")) return err("forbidden");
  const amount = parseAmount(typed, "USD");
  if (!amount.ok || amount.value.minor < 100 || amount.value.minor > 100_000) return err("amount-invalid");
  return deps.transact(() => {
    deps.store.setCreditMinor(amount.value.minor, actorId, deps.clock());
    recordActivity(deps, { actorId, action: "referral-credit.amount-set", recordType: "user", recordId: actorId, context: { minor: amount.value.minor } });
    return ok({ amount: dollars(amount.value.minor) });
  });
}

/** What a referral earns now, for the form that changes it. */
export function creditAmount(deps: ReferralCreditDeps, actorId: Id | null): string | null {
  return may(deps, actorId, "referral.manage") ? (formatMoney({ minor: deps.store.creditMinor() ?? DEFAULT_CREDIT_MINOR, currency: "USD" }).replace(/^\$/, "")) : null;
}

/** Who referred an opportunity, for its page. */
export function referredByView(deps: ReferralCreditDeps, actorId: Id | null, opportunityId: Id): { readonly text: string; readonly organizationId: string; readonly name: string; readonly canEdit: boolean; readonly clients: readonly { readonly value: string; readonly label: string }[] } | null {
  if (!may(deps, actorId, "opportunity.view")) return null;
  const who = deps.store.referredBy(opportunityId);
  if (!who) return null;
  const text = who.organizationId ? (deps.clientName(who.organizationId) ?? "") : (who.name ?? "");
  const canEdit = may(deps, actorId, "opportunity.edit");
  return { text, organizationId: who.organizationId ?? "", name: who.name ?? "", canEdit, clients: canEdit ? deps.clientOptions().filter((one) => one.id !== who.clientId).map((one) => ({ value: one.id, label: one.name })) : [] };
}
