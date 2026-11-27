// Change requests: work beyond what was agreed. Potomac drafts one with its
// price and hours and sends it; the client approves or declines in the
// portal, or Potomac records an answer given by phone or email. Approving
// raises the project's budget by the change and drafts its invoice, in the
// same transaction. Permissions: `finance.view` to see, `finance.edit` to
// draft, send, withdraw and record an answer. The client's own answer goes
// through the portal, which checks the project is theirs.
import { decideChange, newChangeRequest, sendChange, withdrawChange, CHANGE_STATUS_LABELS, type ChangeError, type ChangeInput, type ChangeRequest } from "../domain/change-request.ts";
import { defaultFinance } from "../domain/budget.ts";
import { newInvoice, invoiceLabel } from "../domain/invoice.ts";
import { authorize } from "../../identity/index.ts";
import { err, formatMoney, ok, readableHours, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { FinanceDeps, Refused } from "./commands.ts";

const allowed = (deps: FinanceDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;

/** Drafts a change on an active project. */
export function addChangeRequest(deps: FinanceDeps, actorId: Id | null, projectId: Id, input: ChangeInput): Result<ChangeRequest, Refused | ChangeError | "project-closed"> {
  if (!allowed(deps, actorId, "finance.edit")) return err("forbidden");
  return deps.transact(() => {
    const project = deps.projects.get(projectId);
    if (!project) return err("not-found");
    if (project.status !== "active") return err("project-closed");
    const made = newChangeRequest({ id: deps.newId(), projectId, number: deps.changes.nextNumber(projectId), createdBy: actorId }, input);
    if (!made.ok) return made;
    deps.changes.insert(made.value, deps.clock());
    recordActivity(deps, { actorId, action: "change-request.drafted", recordType: "change-request", recordId: made.value.id, context: { projectId, number: made.value.number, minor: made.value.amount.minor } });
    return ok(made.value);
  });
}

/** Sends a draft: it shows in the client's portal, waiting for their answer. */
export function sendChangeRequest(deps: FinanceDeps, actorId: Id | null, changeId: Id): Result<ChangeRequest, Refused | "already-sent"> {
  if (!allowed(deps, actorId, "finance.edit")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.changes.get(changeId);
    if (!found) return err("not-found");
    const sent = sendChange(found, deps.clock());
    if (!sent.ok) return sent;
    deps.changes.update(sent.value, deps.clock());
    recordActivity(deps, { actorId, action: "change-request.sent", recordType: "change-request", recordId: changeId, context: { projectId: found.projectId, number: found.number } });
    return ok(sent.value);
  });
}

/** Takes a change back before it is answered. */
export function withdrawChangeRequest(deps: FinanceDeps, actorId: Id | null, changeId: Id): Result<ChangeRequest, Refused | "already-answered"> {
  if (!allowed(deps, actorId, "finance.edit")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.changes.get(changeId);
    if (!found) return err("not-found");
    const gone = withdrawChange(found);
    if (!gone.ok) return gone;
    deps.changes.update(gone.value, deps.clock());
    recordActivity(deps, { actorId, action: "change-request.withdrawn", recordType: "change-request", recordId: changeId, context: { projectId: found.projectId, number: found.number } });
    return ok(gone.value);
  });
}

type DecideError = "not-waiting" | "invalid-decision" | "note-too-long";

/**
 * Records the answer. Inside a transaction. On approval the budget, if the
 * project has one, grows by the change's price and hours, and a draft
 * invoice for a priced change is made for Potomac to check and send.
 */
function applyDecision(deps: FinanceDeps, actorId: Id | null, found: ChangeRequest, decision: string, note: string | null | undefined, by: NonNullable<ChangeRequest["decidedBy"]>): Result<ChangeRequest, DecideError> {
  const at = deps.clock();
  const decided = decideChange(found, decision, note, by, at);
  if (!decided.ok) return decided;
  let change = decided.value;
  const clientUserId = "clientUserId" in by ? by.clientUserId : null;
  if (change.status === "approved") {
    const before = deps.finance.get(change.projectId) ?? defaultFinance(change.projectId);
    const baseline = deps.baselines.get(change.projectId);
    const amount = before.budget ?? baseline?.amount ?? null;
    const minutes = before.budgetMinutes ?? (baseline && baseline.minutes > 0 ? baseline.minutes : null);
    const raised = {
      ...before,
      budget: amount === null ? null : { minor: amount.minor + change.amount.minor, currency: amount.currency },
      budgetMinutes: minutes === null ? null : minutes + (change.minutes ?? 0),
    };
    if (raised.budget?.minor !== before.budget?.minor || raised.budgetMinutes !== before.budgetMinutes) {
      deps.finance.save(raised, at);
      recordActivity(deps, { actorId, action: "project.budget-raised-by-change", recordType: "project", recordId: change.projectId, context: { number: change.number, ...(raised.budget ? { minor: raised.budget.minor } : {}), ...(raised.budgetMinutes !== null ? { minutes: raised.budgetMinutes } : {}) } });
    }
    if (change.amount.minor > 0) {
      const project = deps.projects.get(change.projectId);
      if (!project) throw new Error("A change request's project is gone.");
      if (project.organizationId === null) throw new Error("A company project has no client to approve a change.");
      const invoice = newInvoice(
        { id: deps.newId(), organizationId: project.organizationId, projectId: change.projectId, number: deps.invoices.nextNumber(), createdBy: actorId ?? project?.ownerId ?? change.createdBy },
        { kind: "other", description: `Change ${change.number}: ${change.title}`.slice(0, 300), amount: (change.amount.minor / 100).toFixed(2), note: `Drafted by HQ when change ${change.number} was approved.` },
      );
      if (!invoice.ok) throw new Error(`Could not draft the change's invoice: ${invoice.error}`);
      deps.invoices.insert(invoice.value, at);
      recordActivity(deps, { actorId, action: "invoice.drafted-from-change", recordType: "invoice", recordId: invoice.value.id, context: { projectId: change.projectId, number: invoice.value.number, kind: "other", minor: invoice.value.total.minor } });
      change = { ...change, invoiceId: invoice.value.id };
    }
  }
  deps.changes.update(change, at);
  recordActivity(deps, {
    actorId,
    action: change.status === "approved" ? "change-request.approved" : "change-request.declined",
    recordType: "change-request",
    recordId: change.id,
    context: { projectId: change.projectId, number: change.number, minor: change.amount.minor, ...(clientUserId ? { clientUserId } : {}) },
  });
  return ok(change);
}

/** The client's answer, from the portal. The portal has already checked the project is theirs. */
export function decideChangeAsClient(deps: FinanceDeps, clientUserId: Id, changeId: Id, input: { readonly decision: string; readonly note?: string | null }): Result<ChangeRequest, "not-found" | DecideError> {
  return deps.transact(() => {
    const found = deps.changes.get(changeId);
    if (!found) return err("not-found");
    return applyDecision(deps, null, found, input.decision, input.note, { clientUserId });
  });
}

/** An answer the client gave another way, by phone or email, recorded by Potomac. */
export function recordChangeDecision(deps: FinanceDeps, actorId: Id | null, changeId: Id, input: { readonly decision: string; readonly note?: string | null }): Result<ChangeRequest, Refused | DecideError> {
  if (!allowed(deps, actorId, "finance.edit")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.changes.get(changeId);
    if (!found) return err("not-found");
    return applyDecision(deps, actorId, found, input.decision, input.note, { userId: actorId });
  });
}

export type ChangeLine = {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly price: string;
  readonly hours: string;
  readonly status: ChangeRequest["status"];
  readonly statusLabel: string;
  readonly answered: string;
  readonly note: string;
  readonly invoiceId: string;
  readonly invoiceLabel: string;
};

function lineOf(deps: FinanceDeps, change: ChangeRequest, viewer: "staff" | "client"): ChangeLine {
  const invoice = change.invoiceId ? deps.invoices.get(change.invoiceId) : null;
  let answered = "";
  if (change.decidedAt && change.decidedBy) {
    const when = deps.formatWhen(change.decidedAt);
    if (viewer === "client") answered = `on ${when}`;
    else if ("userId" in change.decidedBy) answered = `by the client, recorded by ${deps.users.get(change.decidedBy.userId)?.name ?? "someone"}, ${when}`;
    else answered = `by the client in the portal, ${when}`;
  }
  return {
    id: change.id,
    label: `Change ${change.number}`,
    title: change.title,
    description: change.description,
    price: change.amount.minor === 0 ? "No charge" : formatMoney(change.amount),
    hours: change.minutes ? readableHours(change.minutes) : "",
    status: change.status,
    statusLabel: viewer === "client" && change.status === "sent" ? "Waiting for your answer" : CHANGE_STATUS_LABELS[change.status],
    answered,
    note: change.decisionNote,
    invoiceId: invoice?.id ?? "",
    invoiceLabel: invoice ? invoiceLabel(invoice.number) : "",
  };
}

export type ProjectChangesView = { readonly items: readonly ChangeLine[]; readonly canEdit: boolean; readonly open: boolean };

/** A project's changes, newest first, for its money page. Permission: `finance.view`. */
export function projectChanges(deps: FinanceDeps, actorId: Id | null, projectId: Id): Result<ProjectChangesView, Refused> {
  if (!allowed(deps, actorId, "finance.view")) return err("forbidden");
  const project = deps.projects.get(projectId);
  if (!project) return err("not-found");
  return ok({ items: deps.changes.listFor(projectId).map((one) => lineOf(deps, one, "staff")), canEdit: allowed(deps, actorId, "finance.edit"), open: project.status === "active" });
}

/** What the client sees on their project: changes sent to them and their answers. Never drafts or withdrawn ones. The caller checks the project is theirs. */
export function changesForClient(deps: FinanceDeps, projectId: Id): readonly ChangeLine[] {
  return deps.changes
    .listFor(projectId)
    .filter((one) => one.status === "sent" || one.status === "approved" || one.status === "declined")
    .map((one) => lineOf(deps, one, "client"));
}
