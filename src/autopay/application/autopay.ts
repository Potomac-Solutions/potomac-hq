// Automatic payment of plan invoices (2026-11-26). The client saves a
// payment method at the platform from the portal; HQ never sees the card or
// account, only the platform's token. Each plan invoice is charged the day
// it is sent, retried twice if declined, and a person is asked to step in
// when it keeps failing or an answer was lost.
import { lastTryDeclined, nextTry, type Try } from "../domain/autopay.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, formatMoney, friendlyDay, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";

/** A platform that can save a payment method and charge it later. */
export type SavedPay = {
  readonly platform: string;
  /** Starts saving a method: where to send the client to approve it. */
  begin(input: { readonly key: string; readonly back: string; readonly cancel: string }): Promise<{ readonly ok: true; readonly setup: string; readonly url: string } | { readonly ok: false; readonly reason: string }>;
  /** After they approved: the saved method's token, and how to show it. */
  keep(setup: string): Promise<{ readonly ok: true; readonly token: string; readonly label: string } | { readonly ok: false; readonly reason: string }>;
  /** Charges a saved method. "unknown" when the platform's answer was lost: the money may or may not be taken. */
  charge(input: { readonly token: string; readonly key: string; readonly cents: number; readonly currency: string; readonly description: string }): Promise<
    { readonly outcome: "paid"; readonly reference: string } | { readonly outcome: "declined"; readonly reason: string } | { readonly outcome: "unknown"; readonly reason: string }
  >;
  /** Removes the saved method at the platform. */
  forget(token: string): Promise<boolean>;
};

export type Autopay = { readonly organizationId: Id; readonly platform: string; readonly token: string | null; readonly label: string; readonly setupRef: string | null; readonly setupUrl: string | null; readonly setUpBy: Id | null; readonly setUpAt: string | null; readonly stoppedAt: string | null };
export type PlanInvoice = { readonly id: Id; readonly number: number; readonly organizationId: Id; readonly clientName: string; readonly owedMinor: number; readonly currency: "USD"; readonly createdBy: Id };

export type AutopayStore = {
  get(organizationId: Id): Autopay | null;
  save(autopay: Autopay, at: string): void;
  /** Whether the client has a plan (an active recurring invoice). */
  hasPlan(organizationId: Id): boolean;
  /** Sent plan invoices with money owed, at clients with autopay on. */
  due(): readonly PlanInvoice[];
  tries(invoiceId: Id): readonly Try[];
  startTry(entry: { readonly id: Id; readonly invoiceId: Id; readonly owedMinor: number; readonly triedOn: string; readonly createdAt: string }): boolean;
  endTry(id: Id, outcome: "paid" | "declined" | "unknown", reference: string, reason: string): void;
  recent(organizationId: Id): readonly { readonly number: number; readonly triedOn: string; readonly outcome: string; readonly reason: string }[];
};

export type AutopayDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly today: () => string;
  readonly publicUrl: string;
  readonly autopay: AutopayStore;
  /** null when the payment platform can't save methods (only PayPal, for now). */
  readonly saved: SavedPay | null;
  readonly record: (invoiceId: Id, input: { readonly minor: number; readonly platform: string; readonly reference: string }) => Result<unknown, string>;
  readonly makeTodo: (input: { readonly projectId: null; readonly organizationId: Id; readonly title: string; readonly description: string; readonly assigneeId: Id | null }) => Result<{ readonly id: Id }, string>;
};

type Session = { readonly organizationId: Id; readonly clientUserId: Id };
const PLATFORM = { paypal: "PayPal", test: "the test platform" } as Readonly<Record<string, string>>;

export type PortalAutopay = { readonly offered: boolean; readonly on: boolean; readonly label: string; readonly platform: string; readonly since: string };

export function portalAutopay(deps: AutopayDeps, session: Session): PortalAutopay {
  const found = deps.autopay.get(session.organizationId);
  const on = found !== null && found.token !== null && found.stoppedAt === null;
  const platform = PLATFORM[deps.saved?.platform ?? found?.platform ?? ""] ?? "";
  // Offered when the platform can save methods and there's a plan to pay; shown while on regardless.
  return { offered: on || (deps.saved !== null && deps.autopay.hasPlan(session.organizationId)), on, label: on ? found.label : "", platform, since: on && found.setUpAt ? friendlyDay(found.setUpAt.slice(0, 10), deps.today()) : "" };
}

export type AutopayError = "unavailable" | "no-plan" | "platform-failed" | "not-started";

/** The client asked to pay their plan automatically: off to the platform to approve it. */
export async function startAutopay(deps: AutopayDeps, session: Session): Promise<Result<{ readonly next: string }, AutopayError>> {
  if (!deps.saved) return err("unavailable");
  if (!deps.autopay.hasPlan(session.organizationId)) return err("no-plan");
  const began = await deps.saved.begin({ key: `autopay:${session.organizationId}:${deps.clock()}`, back: `${deps.publicUrl}/portal/autopay/done`, cancel: `${deps.publicUrl}/portal/autopay/cancelled` });
  if (!began.ok) return err("platform-failed");
  const was = deps.autopay.get(session.organizationId);
  deps.autopay.save({ organizationId: session.organizationId, platform: deps.saved.platform, token: was?.stoppedAt === null ? was.token : null, label: was?.stoppedAt === null ? was.label : "", setupRef: began.setup, setupUrl: began.url, setUpBy: was?.setUpBy ?? null, setUpAt: was?.setUpAt ?? null, stoppedAt: was?.stoppedAt ?? null }, deps.clock());
  return ok({ next: "/portal/autopay/go" });
}

/** Where the client goes to approve at the platform, once started. */
export function autopayApproveUrl(deps: AutopayDeps, session: Session): string | null {
  return deps.autopay.get(session.organizationId)?.setupUrl ?? null;
}

/** Back from the platform: keep the method they approved. Reads only the step HQ started for this client. */
export async function finishAutopay(deps: AutopayDeps, session: Session): Promise<Result<{ readonly label: string; readonly platform: string }, AutopayError>> {
  const was = deps.autopay.get(session.organizationId);
  if (!deps.saved) return err("unavailable");
  if (!was?.setupRef) return err("not-started");
  const kept = await deps.saved.keep(was.setupRef);
  if (!kept.ok) return err("platform-failed");
  const old = was.stoppedAt === null && was.token && was.token !== kept.token ? was.token : null;
  const at = deps.clock();
  deps.transact(() => {
    deps.autopay.save({ organizationId: session.organizationId, platform: deps.saved?.platform ?? was.platform, token: kept.token, label: kept.label, setupRef: null, setupUrl: null, setUpBy: session.clientUserId, setUpAt: at, stoppedAt: null }, at);
    recordActivity(deps, { actorId: null, action: "client.autopay-on", recordType: "client", recordId: session.organizationId, context: { clientUserId: session.clientUserId, platform: deps.saved?.platform ?? "" } });
  });
  // A method they replaced is removed at the platform too.
  if (old) await deps.saved.forget(old).catch(() => false);
  return ok({ label: kept.label, platform: PLATFORM[deps.saved.platform] ?? "" });
}

/** Turns automatic payment off, from the portal or by staff. Removes the saved method at the platform. */
export async function stopAutopay(deps: AutopayDeps, who: { readonly session: Session } | { readonly actorId: Id | null; readonly organizationId: Id }): Promise<Result<{ readonly stopped: true }, "forbidden">> {
  const organizationId = "session" in who ? who.session.organizationId : who.organizationId;
  if (!("session" in who) && (who.actorId === null || !authorize(deps, who.actorId, "client.set-status").ok)) return err("forbidden");
  const was = deps.autopay.get(organizationId);
  if (!was || was.stoppedAt !== null || !was.token) return ok({ stopped: true });
  const at = deps.clock();
  deps.transact(() => {
    deps.autopay.save({ ...was, token: null, setupRef: null, setupUrl: null, stoppedAt: at }, at);
    recordActivity(deps, { actorId: "session" in who ? null : who.actorId, action: "client.autopay-off", recordType: "client", recordId: organizationId, context: "session" in who ? { clientUserId: who.session.clientUserId } : {} });
  });
  if (deps.saved) await deps.saved.forget(was.token).catch(() => false);
  return ok({ stopped: true });
}

export type ClientAutopay = { readonly on: boolean; readonly label: string; readonly since: string; readonly recent: readonly { readonly label: string; readonly when: string; readonly outcome: string }[]; readonly canStop: boolean };

const OUTCOMES: Readonly<Record<string, string>> = { paid: "Paid", declined: "Declined", unknown: "No clear answer: check the platform", trying: "No clear answer: check the platform" };

/** For the client page in HQ. */
export function clientAutopay(deps: AutopayDeps, actorId: Id | null, organizationId: Id): ClientAutopay | null {
  if (actorId === null || !authorize(deps, actorId, "client.view").ok) return null;
  const found = deps.autopay.get(organizationId);
  const recent = deps.autopay.recent(organizationId);
  if (!found && recent.length === 0) return null;
  const on = found !== null && found.token !== null && found.stoppedAt === null;
  return {
    on,
    label: on ? found.label : "",
    since: on && found.setUpAt ? friendlyDay(found.setUpAt.slice(0, 10), deps.today()) : "",
    recent: recent.map((one) => ({ label: `INV-${String(one.number).padStart(4, "0")}`, when: friendlyDay(one.triedOn, deps.today()), outcome: OUTCOMES[one.outcome] + (one.outcome === "declined" && one.reason ? ` (${one.reason})` : "") })),
    canStop: on && authorize(deps, actorId, "client.set-status").ok,
  };
}

/**
 * The daily run: charges each plan invoice that's due a try. A try is
 * written before the platform is asked, and its key makes a repeat the same
 * charge at the platform, so nothing is charged twice.
 */
export async function runAutopay(deps: AutopayDeps): Promise<{ readonly paid: number; readonly declined: number; readonly unclear: number }> {
  const saved = deps.saved;
  if (!saved) return { paid: 0, declined: 0, unclear: 0 };
  const today = deps.today();
  let paid = 0;
  let declined = 0;
  let unclear = 0;
  for (const invoice of deps.autopay.due()) {
    const setup = deps.autopay.get(invoice.organizationId);
    if (!setup?.token || setup.stoppedAt !== null || setup.platform !== saved.platform) continue;
    if (!nextTry(deps.autopay.tries(invoice.id), today).now) continue;
    const tryId = deps.newId();
    if (!deps.autopay.startTry({ id: tryId, invoiceId: invoice.id, owedMinor: invoice.owedMinor, triedOn: today, createdAt: deps.clock() })) continue;
    const label = `INV-${String(invoice.number).padStart(4, "0")}`;
    let result: Awaited<ReturnType<SavedPay["charge"]>>;
    try {
      result = await saved.charge({ token: setup.token, key: `autopay:${invoice.id}:${invoice.owedMinor}:${today}`, cents: invoice.owedMinor, currency: invoice.currency, description: `Potomac Solutions invoice ${label}` });
    } catch {
      result = { outcome: "unknown", reason: "no answer" };
    }
    const owed = formatMoney({ minor: invoice.owedMinor, currency: invoice.currency });
    if (result.outcome === "paid") {
      const reference = result.reference;
      deps.autopay.endTry(tryId, "paid", reference.slice(0, 100), "");
      const recorded = deps.record(invoice.id, { minor: invoice.owedMinor, platform: `${PLATFORM[saved.platform] ?? saved.platform} autopay`, reference });
      if (!recorded.ok)
        deps.transact(() => {
          deps.makeTodo({ projectId: null, organizationId: invoice.organizationId, title: `Autopay took ${owed} for ${label}, but it couldn't go on the invoice`, description: `${PLATFORM[saved.platform] ?? saved.platform} reference ${reference}. The invoice changed meanwhile (${recorded.error}). Check it, and refund the client if it was paid another way.`, assigneeId: invoice.createdBy });
        });
      paid++;
      continue;
    }
    const reason = result.reason.slice(0, 200);
    deps.autopay.endTry(tryId, result.outcome, "", reason);
    deps.transact(() => {
      recordActivity(deps, { actorId: null, action: result.outcome === "declined" ? "invoice.autopay-declined" : "invoice.autopay-unclear", recordType: "invoice", recordId: invoice.id, context: { number: invoice.number, reason } });
      if (result.outcome === "unknown")
        deps.makeTodo({ projectId: null, organizationId: invoice.organizationId, title: `Check whether autopay took ${owed} for ${label}`.slice(0, 120), description: `HQ asked ${PLATFORM[saved.platform] ?? saved.platform} to charge ${invoice.clientName}'s saved method and got no clear answer (${reason}). It won't try again by itself. Look in the platform: if it was paid, record the payment on the invoice; if not, ask the client.`, assigneeId: invoice.createdBy });
      else if (lastTryDeclined(deps.autopay.tries(invoice.id)))
        deps.makeTodo({ projectId: null, organizationId: invoice.organizationId, title: `Autopay declined three times for ${label}`.slice(0, 120), description: `${invoice.clientName}'s saved method was declined (${reason}). Ask them to update it in their portal, or to pay ${owed} another way.`, assigneeId: invoice.createdBy });
    });
    if (result.outcome === "declined") declined++;
    else unclear++;
  }
  return { paid, declined, unclear };
}
