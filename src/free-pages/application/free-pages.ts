// Free landing pages (decision 0013, section 3). Every client may have one,
// free for good: an informational page at <name>.potomac.solutions, four
// rounds of changes and a final approval. Potomac's people record it and its
// rounds (`free-page.manage`); the client asks for it, sends rounds and
// approves it in the portal. Rounds after the free ones are paid work, and
// the client is told so before they send one.
import { addressOf, canApprove, canAskForChanges, cleanDomain, cleanRepo, cleanSubdomain, FREE_ROUNDS, isApproved, isPageStatus, nextRound, PAGE_STATUS_LABELS, PAGE_STATUSES, PAID_CHANGES, repoText, roundsUsedText, roundText, type FreePage, type PageStatus, type Round, type DomainError, type RoundError, type SubdomainError } from "../domain/free-page.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { FreePageStore, RoundStore } from "./ports.ts";

export type FreePagesDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly pages: FreePageStore;
  readonly rounds: RoundStore;
  readonly formatWhen: (instant: string) => string;
  readonly clientName: (organizationId: Id) => string | null;
  /** The emails and phone numbers a client's contacts and portal users have, for one free page per person. */
  readonly peopleAt: (organizationId: Id) => { readonly emails: readonly string[]; readonly phones: readonly string[] };
  /**
   * Adds the client's domain to their renewals, yearly, ready to bill, unless
   * it's there already (Renewals). Answers whether it was added, or why not.
   */
  readonly addDomainRenewal?: (actorId: Id, organizationId: Id, input: { readonly domain: string; readonly renewsOn: string; readonly cost: string; readonly price: string }) => Result<"added" | "already-there", string>;
};

/** Who is signed in to the portal. */
export type ClientSide = { readonly clientUserId: Id; readonly organizationId: Id; readonly name: string };

type Refused = "forbidden" | "not-found";
const may = (deps: FreePagesDeps, actorId: Id | null, permission: string): actorId is Id => actorId !== null && authorize(deps, actorId, permission).ok;
const digits = (phone: string) => phone.replace(/\D/g, "").slice(-10);

/** Another client whose people already have a free page, or null. One free page a person, like the free call. */
function alreadyHasOne(deps: FreePagesDeps, organizationId: Id): Id | null {
  const mine = deps.peopleAt(organizationId);
  const emails = new Set(mine.emails.map((one) => one.toLowerCase()));
  const phones = new Set(mine.phones.map(digits).filter((one) => one.length === 10));
  for (const page of deps.pages.list()) {
    if (page.organizationId === organizationId) continue;
    const theirs = deps.peopleAt(page.organizationId);
    if (theirs.emails.some((one) => emails.has(one.toLowerCase())) || theirs.phones.some((one) => phones.has(digits(one)))) return page.organizationId;
  }
  return null;
}

function note(deps: FreePagesDeps, who: { readonly actorId: Id } | { readonly client: ClientSide }, action: string, page: FreePage, context: Record<string, string | number | boolean> = {}): void {
  recordActivity(deps, {
    actorId: "actorId" in who ? who.actorId : null,
    action,
    recordType: "free-page",
    recordId: page.id,
    context: { organizationId: page.organizationId, ...("client" in who ? { clientUserId: who.client.clientUserId, by: "client" } : {}), ...context },
  });
}

// ---------- Potomac's side ----------

export type SetUpInput = {
  readonly subdomain: string;
  readonly status: string;
  readonly repo: string;
  /** "own": on the client's own domain; anything else: a name on potomac.solutions. */
  readonly where?: string;
  readonly ownDomain?: string;
  /** With an own domain: when it renews, what it costs Potomac and what the client is billed, for its renewal. */
  readonly renewsOn?: string;
  readonly cost?: string;
  readonly price?: string;
};
export type SetUpError = Refused | SubdomainError | DomainError | "subdomain-taken" | "domain-taken" | "invalid-status" | "repo-invalid" | "already-has-one";

/** A free page that was saved, and what happened to its domain's renewal when one was asked for. */
export type SetUp = FreePage & { readonly renewal: "added" | "already-there" | "not-asked" | "failed" };

/** Records a client's free page, or changes its address, status or repository. */
export function setUpFreePage(deps: FreePagesDeps, actorId: Id | null, organizationId: Id, input: SetUpInput): Result<SetUp, SetUpError> {
  if (!may(deps, actorId, "free-page.manage")) return err("forbidden");
  const own = input.where === "own";
  // One address: the client's own domain, or a name on potomac.solutions.
  const subdomain = own ? ok(null) : cleanSubdomain(input.subdomain);
  if (!subdomain.ok) return subdomain;
  const ownDomain = own ? cleanDomain(input.ownDomain ?? "") : ok(null);
  if (!ownDomain.ok) return ownDomain;
  if (!isPageStatus(input.status)) return err("invalid-status");
  const status: PageStatus = input.status;
  const repo = cleanRepo(input.repo);
  if (!repo.ok) return repo;
  const saved = deps.transact((): Result<FreePage, SetUpError> => {
    if (deps.clientName(organizationId) === null) return err("not-found");
    const taken = subdomain.value ? deps.pages.bySubdomain(subdomain.value) : null;
    if (taken && taken.organizationId !== organizationId) return err("subdomain-taken");
    const domainTaken = ownDomain.value ? deps.pages.byOwnDomain(ownDomain.value) : null;
    if (domainTaken && domainTaken.organizationId !== organizationId) return err("domain-taken");
    const at = deps.clock();
    const existing = deps.pages.forOrganization(organizationId);
    if (!existing) {
      if (alreadyHasOne(deps, organizationId)) return err("already-has-one");
      const page: FreePage = { id: deps.newId(), organizationId, subdomain: subdomain.value, ownDomain: ownDomain.value, status, repo: repo.value, approvedAt: isApproved(status) ? at : null };
      deps.pages.insert(page, at);
      note(deps, { actorId }, "free-page.set-up", page, { status, subdomain: page.subdomain ?? "", ownDomain: page.ownDomain ?? "" });
      return ok(page);
    }
    const page: FreePage = { ...existing, subdomain: subdomain.value, ownDomain: ownDomain.value, status, repo: repo.value, approvedAt: isApproved(status) ? (existing.approvedAt ?? at) : null };
    deps.pages.save(page, at);
    note(deps, { actorId }, "free-page.changed", page, { from: existing.status, status, subdomain: page.subdomain ?? "", ownDomain: page.ownDomain ?? "" });
    return ok(page);
  });
  if (!saved.ok) return saved;
  // The domain is the client's to pay for: with a renewal date, it goes on their renewals, ready to bill.
  // Renewals keep their own transaction, so this follows the page's.
  const domain = saved.value.ownDomain;
  if (!domain || !(input.renewsOn ?? "").trim() || !deps.addDomainRenewal) return ok({ ...saved.value, renewal: "not-asked" });
  const added = deps.addDomainRenewal(actorId, organizationId, { domain, renewsOn: input.renewsOn ?? "", cost: input.cost ?? "", price: input.price ?? "" });
  return ok({ ...saved.value, renewal: added.ok ? added.value : "failed" });
}

function addRound(deps: FreePagesDeps, page: FreePage, text: string, who: { readonly actorId: Id } | { readonly client: ClientSide }): Round {
  const next = nextRound(page, deps.rounds.listFor(page.id));
  const at = deps.clock();
  const round: Round = { id: deps.newId(), freePageId: page.id, number: next.number, text, free: next.free, from: "client" in who ? "client" : "staff", doneAt: null, createdAt: at };
  deps.rounds.insert(round, "client" in who ? { clientUserId: who.client.clientUserId } : { userId: who.actorId });
  note(deps, who, "free-page.round-asked", page, { number: round.number, free: round.free });
  return round;
}

/** A round the client asked for by phone or email, written down. */
export function recordRound(deps: FreePagesDeps, actorId: Id | null, organizationId: Id, typed: string): Result<Round, Refused | RoundError | "not-ready"> {
  if (!may(deps, actorId, "free-page.manage")) return err("forbidden");
  const text = roundText(typed);
  if (!text.ok) return text;
  return deps.transact(() => {
    const page = deps.pages.forOrganization(organizationId);
    if (!page) return err("not-found");
    if (!canAskForChanges(page.status)) return err("not-ready");
    return ok(addRound(deps, page, text.value, { actorId }));
  });
}

/** The changes in a round are made (or, for a paid one, priced): it leaves Today. */
export function markRoundDone(deps: FreePagesDeps, actorId: Id | null, roundId: Id): Result<Round, Refused> {
  if (!may(deps, actorId, "free-page.manage")) return err("forbidden");
  return deps.transact(() => {
    const round = deps.rounds.get(roundId);
    const page = round ? deps.pages.get(round.freePageId) : null;
    if (!round || !page) return err("not-found");
    if (round.doneAt) return ok(round);
    const at = deps.clock();
    deps.rounds.markDone(round.id, actorId, at);
    note(deps, { actorId }, "free-page.round-done", page, { number: round.number });
    return ok({ ...round, doneAt: at });
  });
}

export type RoundLine = { readonly id: string; readonly number: number; readonly text: string; readonly free: boolean; readonly from: string; readonly when: string; readonly done: boolean };
export type FreePageView = {
  readonly organizationId: string;
  readonly clientName: string;
  readonly exists: boolean;
  readonly subdomain: string;
  /** "own" when the page is on the client's own domain, "potomac" otherwise. */
  readonly where: "own" | "potomac";
  readonly ownDomain: string;
  readonly address: string;
  readonly status: PageStatus | "";
  readonly statusLabel: string;
  readonly repo: string;
  readonly approved: boolean;
  readonly used: string;
  readonly freeLeft: number;
  readonly rounds: readonly RoundLine[];
  readonly canManage: boolean;
  /** A zip of its code can be had: approved, with a repository. */
  readonly downloadable: boolean;
  readonly statuses: readonly { readonly value: string; readonly label: string }[];
};

function viewOf(deps: FreePagesDeps, organizationId: Id, page: FreePage | null, canManage: boolean): FreePageView {
  const rounds = page ? deps.rounds.listFor(page.id) : [];
  return {
    organizationId,
    clientName: deps.clientName(organizationId) ?? "",
    exists: page !== null,
    subdomain: page?.subdomain ?? "",
    where: page?.ownDomain ? "own" : "potomac",
    ownDomain: page?.ownDomain ?? "",
    address: addressOf(page),
    status: page?.status ?? "",
    statusLabel: page ? PAGE_STATUS_LABELS[page.status] : "",
    repo: repoText(page?.repo ?? null),
    approved: page !== null && isApproved(page.status),
    used: roundsUsedText(rounds),
    freeLeft: page && !isApproved(page.status) ? Math.max(0, FREE_ROUNDS - rounds.filter((one) => one.free).length) : 0,
    rounds: rounds.map((one) => ({ id: one.id, number: one.number, text: one.text, free: one.free, from: one.from === "client" ? "The client" : "Potomac, from a call or email", when: deps.formatWhen(one.createdAt), done: one.doneAt !== null })),
    canManage,
    downloadable: page !== null && isApproved(page.status) && page.repo !== null,
    statuses: PAGE_STATUSES.map((value) => ({ value, label: PAGE_STATUS_LABELS[value] })),
  };
}

/** A client's free page for Potomac's people, or null for someone who may not see clients. */
export function clientFreePage(deps: FreePagesDeps, actorId: Id | null, organizationId: Id): FreePageView | null {
  if (!may(deps, actorId, "client.view") || deps.clientName(organizationId) === null) return null;
  return viewOf(deps, organizationId, deps.pages.forOrganization(organizationId), may(deps, actorId, "free-page.manage"));
}

export type FreePageLine = { readonly organizationId: string; readonly clientName: string; readonly address: string; readonly statusLabel: string; readonly used: string; readonly open: number };

/** Every free page, newest first. */
export function allFreePages(deps: FreePagesDeps, actorId: Id | null): Result<readonly FreePageLine[], "forbidden"> {
  if (!may(deps, actorId, "client.view")) return err("forbidden");
  return ok(
    deps.pages.list().map((page) => {
      const rounds = deps.rounds.listFor(page.id);
      return { organizationId: page.organizationId, clientName: deps.clientName(page.organizationId) ?? "", address: addressOf(page), statusLabel: PAGE_STATUS_LABELS[page.status], used: roundsUsedText(rounds), open: rounds.filter((one) => one.doneAt === null).length };
    }),
  );
}

export type WaitingRound = { readonly key: string; readonly text: string; readonly detail: string; readonly href: string; readonly since: string };

/** Rounds asked for and not yet done, for Today: the oldest first. */
export function roundsWaiting(deps: FreePagesDeps, actorId: Id | null): readonly WaitingRound[] {
  if (!may(deps, actorId, "free-page.manage")) return [];
  return deps.rounds.open().flatMap((round) => {
    const page = deps.pages.get(round.freePageId);
    if (!page) return [];
    const name = deps.clientName(page.organizationId) ?? "A client";
    const text = round.free ? `Round ${round.number} of ${FREE_ROUNDS}: changes to ${name}’s landing page` : `Paid changes to ${name}’s landing page: price them`;
    return [{ key: round.id, text, detail: round.text.length > 120 ? `${round.text.slice(0, 117)}…` : round.text, href: `/clients/${page.organizationId}/landing-page#round-${round.number}`, since: round.createdAt }];
  });
}

// ---------- The client's side ----------

export type PortalFreePage = FreePageView & { readonly canAsk: boolean; readonly canApprove: boolean; readonly paidNext: boolean; readonly paidText: string };

/** The signed-in client's free page; `exists` is false when they haven't asked for one. */
export function portalFreePage(deps: FreePagesDeps, session: ClientSide | null): PortalFreePage | null {
  if (!session) return null;
  const page = deps.pages.forOrganization(session.organizationId);
  const view = viewOf(deps, session.organizationId, page, false);
  const next = page ? nextRound(page, deps.rounds.listFor(page.id)) : { number: 1, free: true };
  return { ...view, canAsk: page !== null && canAskForChanges(page.status), canApprove: page !== null && canApprove(page.status), paidNext: page !== null && !next.free, paidText: PAID_CHANGES };
}

/** The client asks for their free page. */
export function requestFreePage(deps: FreePagesDeps, session: ClientSide | null): Result<FreePage, "not-found" | "already-has-one" | "already-asked"> {
  if (!session) return err("not-found");
  return deps.transact(() => {
    if (deps.pages.forOrganization(session.organizationId)) return err("already-asked");
    if (alreadyHasOne(deps, session.organizationId)) return err("already-has-one");
    const page: FreePage = { id: deps.newId(), organizationId: session.organizationId, subdomain: null, ownDomain: null, status: "requested", repo: null, approvedAt: null };
    deps.pages.insert(page, deps.clock());
    note(deps, { client: session }, "free-page.requested", page);
    return ok(page);
  });
}

/** The client sends a round of changes. Past the free ones, `paid` must say they know it's paid. */
export function sendRound(deps: FreePagesDeps, session: ClientSide | null, typed: string, paidOk: boolean): Result<Round, "not-found" | RoundError | "not-ready" | "paid-not-agreed"> {
  if (!session) return err("not-found");
  const text = roundText(typed);
  if (!text.ok) return text;
  return deps.transact(() => {
    const page = deps.pages.forOrganization(session.organizationId);
    if (!page) return err("not-found");
    if (!canAskForChanges(page.status)) return err("not-ready");
    if (!nextRound(page, deps.rounds.listFor(page.id)).free && !paidOk) return err("paid-not-agreed");
    return ok(addRound(deps, page, text.value, { client: session }));
  });
}

/** The client's final approval. The free page is done. */
export function approveFreePage(deps: FreePagesDeps, session: ClientSide | null): Result<FreePage, "not-found" | "not-ready"> {
  if (!session) return err("not-found");
  return deps.transact(() => {
    const page = deps.pages.forOrganization(session.organizationId);
    if (!page) return err("not-found");
    if (!canApprove(page.status)) return err("not-ready");
    const at = deps.clock();
    const approved: FreePage = { ...page, status: "approved", approvedAt: at };
    deps.pages.save(approved, at);
    note(deps, { client: session }, "free-page.approved", approved);
    return ok(approved);
  });
}

/**
 * The repository to zip for someone who may have it: Potomac's people, or the
 * client whose page it is, once it's approved.
 */
export function archiveOf(deps: FreePagesDeps, who: { readonly actorId: Id | null } | { readonly session: ClientSide | null }, organizationId: Id | null): Result<{ readonly repo: NonNullable<FreePage["repo"]>; readonly fileName: string }, "not-found"> {
  const orgId = "session" in who ? (who.session?.organizationId ?? null) : may(deps, who.actorId, "client.view") ? organizationId : null;
  const page = orgId ? deps.pages.forOrganization(orgId) : null;
  if (!page || !page.repo || !isApproved(page.status)) return err("not-found");
  return ok({ repo: page.repo, fileName: `${page.subdomain ?? page.repo.name}-landing-page.zip` });
}
