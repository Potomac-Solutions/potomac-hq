// What a client does and sees in the portal.
//
// ISOLATION. Every function here takes a ClientSession and shows or changes
// only records of that session's organization. The organization is never read
// from an address or a form: an id from the browser names one record, and
// that record is used only if it belongs to the session's organization.
// Anything else is "not-found", which says nothing about whether it exists.
// test/integration/portal-isolation.test.ts tries every one of these as
// client A against client B's records.
import { newCallRequest, newUpdate, sessionFor, type CallRequest, type ClientSession, type ProjectUpdate } from "../domain/client-user.ts";
import { activate } from "../domain/client-user.ts";

export type { ClientSession };
import { documentForInvoice, invoiceLabel, type InvoiceDocument } from "../../finance/index.ts";
import { decideDeliverable, DELIVERABLE_STATUS_LABELS, HEALTH_LABELS, isMilestoneOverdue, milestoneProgress, nextMilestone, STATUS_LABELS, type Deliverable, type Project } from "../../projects/index.ts";
import { applyDecision, documentFor, PROPOSAL_STATUS_LABELS, type ProposalDocument } from "../../proposals/index.ts";
import { err, formatHours, formatMoney, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { PortalDeps } from "./staff-side.ts";

/** The client a Cookie header is signed in as, or null. Read from storage every time. */
export function clientSession(deps: PortalDeps, cookieHeader: string): ClientSession | null {
  const who = deps.auth.session(cookieHeader);
  return who ? sessionFor(deps.clientUsers.byPortalAccount(who.account)) : null;
}

export async function signInClient(deps: PortalDeps, input: { readonly email: string; readonly password: string; readonly client: string }): Promise<Result<{ cookie: string }, "wrong" | "locked">> {
  const result = await deps.auth.signIn(input.email, input.password, input.client);
  if (!result.ok) return err(result.error);
  const session = clientSession(deps, result.cookie.split(";")[0] ?? "");
  // A portal account with no active client user is turned away like a wrong password.
  if (!session) return err("wrong");
  deps.transact(() => {
    recordActivity(deps, { actorId: null, action: "client-user.signed-in", recordType: "client-user", recordId: session.clientUserId, context: { organizationId: session.organizationId } });
  });
  return ok({ cookie: result.cookie });
}

/** Ends the session. Answers the cookie that clears it from the browser. */
export async function signOutClient(deps: PortalDeps, cookieHeader: string): Promise<string> {
  const session = clientSession(deps, cookieHeader);
  const cookie = await deps.auth.signOut(cookieHeader);
  if (session) {
    deps.transact(() => {
      recordActivity(deps, { actorId: null, action: "client-user.signed-out", recordType: "client-user", recordId: session.clientUserId, context: { organizationId: session.organizationId } });
    });
  }
  return cookie;
}

/** Uses a one-time link: the person chooses their password and is signed in. An invite also makes their access active. */
export async function acceptPortalLink(deps: PortalDeps, token: string, form: { readonly name: string; readonly password: string }): Promise<{ ok: true; cookie: string } | { ok: false; message: string }> {
  const link = deps.auth.peek(token);
  const user = link ? deps.clientUsers.byEmail(link.email) : null;
  // The link must be for someone HQ invited, whose access has not been turned off.
  if (!link || !user || user.status === "disabled") return { ok: false, message: "That link has expired or been used. Ask Potomac Solutions for a new one." };
  const result = await deps.auth.accept(token, { name: form.name || user.name, password: form.password });
  if (!result.ok) return result;
  deps.transact(() => {
    if (user.status === "invited") {
      const active = activate(user, result.account, form.name);
      if (active.ok) deps.clientUsers.update(active.value, deps.clock());
    }
    recordActivity(deps, { actorId: null, action: "client-user.password-set", recordType: "client-user", recordId: user.id, context: { organizationId: user.organizationId, by: link.kind } });
  });
  return { ok: true, cookie: result.cookie };
}

/** The project, only if it belongs to the session's organization. */
function ownProject(deps: PortalDeps, session: ClientSession, projectId: Id): Project | null {
  const project = deps.projects.get(projectId);
  return project && project.organizationId === session.organizationId ? project : null;
}

export type PortalHomeView = {
  readonly who: string;
  readonly organizationName: string;
  readonly projects: readonly { readonly id: string; readonly name: string; readonly statusLabel: string; readonly healthLabel: string; readonly next: string; readonly progress: string }[];
  readonly proposals: readonly { readonly id: string; readonly title: string; readonly statusLabel: string; readonly waiting: boolean }[];
  readonly invoices: readonly { readonly id: string; readonly label: string; readonly projectName: string; readonly status: string; readonly statusLabel: string; readonly total: string; readonly owed: string; readonly dueOn: string }[];
  readonly calls: readonly { readonly id: string; readonly wanted: string; readonly status: string; readonly confirmedFor: string; readonly reply: string }[];
};

const INVOICE_LABELS: Readonly<Record<string, string>> = { sent: "Waiting for payment", paid: "Paid" };

/** A client sees an invoice once it has been sent. Drafts and voided ones are Potomac's own business. */
function ownInvoices(deps: PortalDeps, session: ClientSession) {
  return deps.invoices.list().filter((invoice) => invoice.organizationId === session.organizationId && (invoice.status === "sent" || invoice.status === "paid"));
}

export function portalHome(deps: PortalDeps, session: ClientSession): PortalHomeView {
  const projects = deps.projects.listFor(session.organizationId);
  return {
    who: session.name,
    organizationName: deps.clients.get(session.organizationId)?.name ?? "",
    projects: projects.map((project) => {
      const milestones = deps.milestones.listFor(project.id);
      const next = nextMilestone(milestones);
      const progress = milestoneProgress(milestones);
      return {
        id: project.id,
        name: project.name,
        statusLabel: STATUS_LABELS[project.status] ?? project.status,
        healthLabel: HEALTH_LABELS[project.health] ?? project.health,
        next: next ? (next.dueOn ? `${next.name}, due ${next.dueOn}` : next.name) : "",
        progress: progress.total > 0 ? `${progress.done} of ${progress.total} milestones done` : "",
      };
    }),
    proposals: deps.proposals.sharedWith(session.organizationId).map((proposal) => ({ id: proposal.id, title: proposal.title, statusLabel: PROPOSAL_STATUS_LABELS[proposal.status] ?? proposal.status, waiting: proposal.status === "sent" })),
    invoices: ownInvoices(deps, session)
      .reverse()
      .map((invoice) => ({
        id: invoice.id,
        label: invoiceLabel(invoice.number),
        projectName: invoice.projectName,
        status: invoice.status,
        statusLabel: INVOICE_LABELS[invoice.status] ?? invoice.status,
        total: formatMoney(invoice.total),
        owed: formatMoney({ minor: invoice.total.minor - invoice.paidMinor, currency: invoice.total.currency }),
        dueOn: invoice.dueOn ?? "",
      })),
    calls: deps.calls.listFor(session.organizationId).map((call) => ({ id: call.id, wanted: call.wanted, status: call.status, confirmedFor: call.confirmedFor ?? "", reply: call.reply })),
  };
}

export type PortalProjectView = {
  readonly project: { readonly id: string; readonly name: string; readonly description: string; readonly statusLabel: string; readonly healthLabel: string; readonly targetOn: string };
  readonly progress: { readonly done: number; readonly total: number };
  readonly next: string;
  readonly milestones: readonly { readonly id: string; readonly name: string; readonly dueOn: string; readonly done: boolean; readonly overdue: boolean }[];
  readonly deliverables: readonly { readonly id: string; readonly title: string; readonly description: string; readonly fileId: string; readonly fileName: string; readonly status: string; readonly statusLabel: string; readonly decisionNote: string; readonly awaiting: boolean }[];
  readonly updates: readonly { readonly id: string; readonly body: string; readonly authorName: string; readonly fromClient: boolean; readonly when: string; readonly whenIso: string }[];
  /** Hours logged as billable on the project (docs/workflow.md, B6). */
  readonly billableHours: string;
};

export function portalProject(deps: PortalDeps, session: ClientSession, projectId: Id): Result<PortalProjectView, "not-found"> {
  const project = ownProject(deps, session, projectId);
  if (!project) return err("not-found");
  const today = deps.today();
  const milestones = deps.milestones.listFor(project.id);
  const next = nextMilestone(milestones);
  return ok({
    project: { id: project.id, name: project.name, description: project.description, statusLabel: STATUS_LABELS[project.status] ?? project.status, healthLabel: HEALTH_LABELS[project.health] ?? project.health, targetOn: project.targetOn ?? "" },
    progress: milestoneProgress(milestones),
    next: next ? (next.dueOn ? `${next.name}, due ${next.dueOn}` : next.name) : "",
    milestones: milestones.map((milestone) => ({ id: milestone.id, name: milestone.name, dueOn: milestone.dueOn ?? "", done: milestone.doneOn !== null, overdue: isMilestoneOverdue(milestone, today) })),
    // A draft is not shared, so the client is never told it exists.
    deliverables: deps.deliverables
      .listFor(project.id)
      .filter((deliverable) => deliverable.status !== "draft")
      .map((deliverable) => ({
        id: deliverable.id,
        title: deliverable.title,
        description: deliverable.description,
        fileId: deliverable.fileId,
        fileName: deliverable.fileName,
        status: deliverable.status,
        statusLabel: deliverable.status === "shared" ? "Waiting for your decision" : (DELIVERABLE_STATUS_LABELS[deliverable.status] ?? deliverable.status).replace("by the client", "by you"),
        decisionNote: deliverable.decisionNote ?? "",
        awaiting: deliverable.status === "shared",
      })),
    updates: deps.updates.listFor(project.id).map((update) => ({ id: update.id, body: update.body, authorName: update.fromClient ? update.authorName : `${update.authorName}, Potomac Solutions`, fromClient: update.fromClient, when: deps.formatWhen(update.createdAt), whenIso: update.createdAt })),
    billableHours: formatHours(deps.time.totals(project.id, { from: "0000-01-01", to: "9999-12-31" }).billableMinutes),
  });
}

/** The client approves a shared deliverable, or asks for changes, saying what. The decision is an activity event. */
export function decideOnDeliverable(deps: PortalDeps, session: ClientSession, deliverableId: Id, input: { readonly decision: string; readonly note?: string | null }): Result<Deliverable, "not-found" | "not-awaiting-decision" | "invalid-decision" | "note-required" | "note-too-long"> {
  return deps.transact(() => {
    const deliverable = deps.deliverables.get(deliverableId);
    const project = deliverable ? ownProject(deps, session, deliverable.projectId) : null;
    // A draft is "not found" too: it was never shared.
    if (!deliverable || !project || deliverable.status === "draft") return err("not-found");
    const at = deps.clock();
    const decided = decideDeliverable(deliverable, input.decision, input.note, at);
    if (!decided.ok) return decided;
    deps.deliverables.update(decided.value, at);
    deps.deliverables.recordDecider(deliverableId, session.clientUserId);
    recordActivity(deps, {
      actorId: null,
      action: decided.value.status === "approved" ? "deliverable.approved" : "deliverable.changes-requested",
      recordType: "deliverable",
      recordId: deliverableId,
      context: { projectId: project.id, clientUserId: session.clientUserId, title: deliverable.title },
    });
    return ok(decided.value);
  });
}

/** A message from the client on one of their projects: a question, or a change they want. */
export function sendMessage(deps: PortalDeps, session: ClientSession, projectId: Id, body: string): Result<ProjectUpdate, "not-found" | "message-empty" | "message-too-long"> {
  return deps.transact(() => {
    const project = ownProject(deps, session, projectId);
    if (!project) return err("not-found");
    const message = newUpdate({ id: deps.newId(), projectId, userId: null, clientUserId: session.clientUserId }, body, deps.clock());
    if (!message.ok) return message;
    deps.updates.insert(message.value);
    recordActivity(deps, { actorId: null, action: "project.message-received", recordType: "project", recordId: projectId, context: { clientUserId: session.clientUserId, updateId: message.value.id } });
    return ok(message.value);
  });
}

/** A proposal the client may see: shared with them, sent at least once, and for their own organization. */
function ownProposal(deps: PortalDeps, session: ClientSession, proposalId: Id) {
  const proposal = deps.proposals.get(proposalId);
  if (!proposal || !proposal.sharedWithClient || proposal.currentVersion === 0) return null;
  const opportunity = deps.opportunities.get(proposal.opportunityId);
  return opportunity && opportunity.organizationId === session.organizationId ? proposal : null;
}

export type PortalProposalView = { readonly document: ProposalDocument; readonly statusLabel: string; readonly canAnswer: boolean; readonly answered: string; readonly who: string };

/** The latest version that was sent. A working copy Potomac has not sent is never shown. */
export function portalProposal(deps: PortalDeps, session: ClientSession, proposalId: Id): Result<PortalProposalView, "not-found"> {
  const proposal = ownProposal(deps, session, proposalId);
  const version = proposal ? deps.proposals.version(proposal.id, proposal.currentVersion) : null;
  if (!proposal || !version) return err("not-found");
  const decision = deps.proposals.decision(proposal.id);
  return ok({
    document: documentFor(deps, proposal, version),
    statusLabel: proposal.status === "sent" || proposal.status === "revised" ? "Waiting for your answer" : (PROPOSAL_STATUS_LABELS[proposal.status] ?? proposal.status),
    canAnswer: proposal.status === "sent",
    answered: decision ? `${decision.decision === "accepted" ? "Accepted" : "Declined"} by ${decision.byName} on ${decision.on}, version ${decision.version}.` : "",
    who: session.name,
  });
}

/**
 * The client accepts or declines by typing their name (docs/tool-boundaries.md:
 * "typed acceptance recording name, time and proposal version"). Accepting
 * does everything recording an acceptance by hand does.
 */
export function answerProposal(
  deps: PortalDeps,
  session: ClientSession,
  proposalId: Id,
  input: { readonly decision: string; readonly typedName: string },
): Result<{ readonly projectId: Id | null }, "not-found" | "typed-name-missing" | "closed" | "not-sent" | "revised-not-sent" | "invalid-decision" | "opportunity-lost" | "decided-by-too-long"> {
  if (input.typedName.trim() === "") return err("typed-name-missing");
  return deps.transact(() => {
    const proposal = ownProposal(deps, session, proposalId);
    if (!proposal) return err("not-found");
    const applied = applyDecision(deps, null, proposal, { decision: input.decision, byName: input.typedName, on: deps.today(), method: "portal", note: null });
    if (!applied.ok) {
      // These cannot happen for a form that sent a name and today's date.
      if (applied.error === "decided-by-missing" || applied.error === "invalid-date" || applied.error === "invalid-method" || applied.error === "note-too-long") return err("invalid-decision");
      return err(applied.error);
    }
    recordActivity(deps, {
      actorId: null,
      action: applied.value.decision.decision === "accepted" ? "proposal.accepted-in-portal" : "proposal.declined-in-portal",
      recordType: "proposal",
      recordId: proposalId,
      context: { clientUserId: session.clientUserId, version: applied.value.decision.version, typedName: applied.value.decision.byName, ...(applied.value.project ? { projectId: applied.value.project.id } : {}) },
    });
    return ok({ projectId: applied.value.project?.id ?? null });
  });
}

/** A sent proposal's latest version as a document for the PDF, for its own client only. */
export function portalProposalDocument(deps: PortalDeps, session: ClientSession | null, proposalId: Id): Result<ProposalDocument, "not-found"> {
  if (!session) return err("not-found");
  const view = portalProposal(deps, session, proposalId);
  return view.ok ? ok(view.value.document) : view;
}

/** One of the client's own sent or paid invoices as a document for the PDF. */
export function portalInvoiceDocument(deps: PortalDeps, session: ClientSession | null, invoiceId: Id): Result<InvoiceDocument, "not-found"> {
  if (!session) return err("not-found");
  const invoice = ownInvoices(deps, session).find((one) => one.id === invoiceId);
  return invoice ? ok(documentForInvoice(invoice)) : err("not-found");
}

/** Asks Potomac for a call. */
export function requestCall(deps: PortalDeps, session: ClientSession, input: { readonly wanted: string; readonly note?: string | null }): Result<CallRequest, "wanted-missing" | "wanted-too-long" | "note-too-long"> {
  const request = newCallRequest({ id: deps.newId(), organizationId: session.organizationId, clientUserId: session.clientUserId }, input);
  if (!request.ok) return request;
  return deps.transact(() => {
    deps.calls.insert(request.value, deps.clock());
    recordActivity(deps, { actorId: null, action: "call.requested", recordType: "call-request", recordId: request.value.id, context: { organizationId: session.organizationId, clientUserId: session.clientUserId } });
    return ok(request.value);
  });
}
