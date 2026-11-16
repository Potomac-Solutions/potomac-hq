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
import { daysUntil, dueText, friendlyDay, howSoon } from "../domain/days.ts";
import { CLIENT_UPLOAD, formatSize, MAX_FILE_BYTES, saveFileFromClient, type FileRecord } from "../../files/index.ts";
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

/** One thing the client is being waited on for, with where to go to do it. */
export type AttentionItem = { readonly key: string; readonly text: string; readonly detail: string; readonly href: string; readonly action: string };

export type PortalHomeView = {
  readonly who: string;
  readonly organizationName: string;
  /** What is waiting on the client, most pressing first. Empty when nothing is. */
  readonly attention: readonly AttentionItem[];
  readonly projects: readonly { readonly id: string; readonly name: string; readonly standing: string; readonly tone: string; readonly next: string; readonly done: number; readonly total: number; readonly steps: string }[];
  /** The newest things Potomac wrote, across every project. */
  readonly latest: readonly { readonly id: string; readonly body: string; readonly projectId: string; readonly projectName: string; readonly who: string; readonly when: string; readonly whenIso: string }[];
  /** Projects a message can be sent about. */
  readonly messageProjects: readonly { readonly id: string; readonly name: string }[];
  readonly proposals: readonly { readonly id: string; readonly title: string; readonly statusLabel: string; readonly waiting: boolean }[];
  readonly invoices: readonly { readonly id: string; readonly label: string; readonly projectName: string; readonly paid: boolean; readonly statusLabel: string; readonly total: string; readonly owed: string; readonly due: string }[];
  /** Everything still owed, added up. Empty when nothing is. */
  readonly owedTotal: string;
  readonly calls: readonly { readonly id: string; readonly wanted: string; readonly status: string; readonly confirmedFor: string; readonly reply: string; readonly phone: string }[];
  /** Everyone at this client who can sign in. */
  readonly people: string;
};

/** A client sees an invoice once it has been sent. Drafts and voided ones are Potomac's own business. */
function ownInvoices(deps: PortalDeps, session: ClientSession) {
  return deps.invoices.list().filter((invoice) => invoice.organizationId === session.organizationId && (invoice.status === "sent" || invoice.status === "paid"));
}

/** How a project is doing, in a word a client would use, and whether it needs a second look. */
function standingOf(project: Project): { standing: string; tone: string } {
  if (project.status === "completed") return { standing: "Finished", tone: "done" };
  if (project.status === "cancelled") return { standing: "Cancelled", tone: "done" };
  if (project.health === "on-track") return { standing: "On track", tone: "ok" };
  return { standing: project.health === "at-risk" ? "Needs attention" : "Behind", tone: "warn" };
}

/** "Design signed off, Sat, Nov 21, in 5 days", or "was due" when the day has passed. */
function stepText(name: string, dueOn: string | null, today: string): string {
  if (!dueOn) return name;
  const days = daysUntil(dueOn, today) ?? 0;
  return days < 0 ? `${name}, was due ${friendlyDay(dueOn, today)}` : `${name}, ${dueText(dueOn, today)}`;
}

const stepsDone = (done: number, total: number): string => (total === 0 ? "" : `${done} of ${total} ${total === 1 ? "step" : "steps"} done`);
const clip = (text: string, most: number): string => (text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text);

export function portalHome(deps: PortalDeps, session: ClientSession): PortalHomeView {
  const today = deps.today();
  const projects = deps.projects.listFor(session.organizationId);
  const open = projects.filter((project) => project.status === "active");
  const invoices = ownInvoices(deps, session);
  const proposals = deps.proposals.sharedWith(session.organizationId);
  const owedOn = (invoice: (typeof invoices)[number]) => invoice.total.minor - invoice.paidMinor;
  const unpaid = invoices.filter((invoice) => invoice.status === "sent" && owedOn(invoice) > 0);
  const owedMinor = unpaid.reduce((sum, invoice) => sum + owedOn(invoice), 0);

  const attention: AttentionItem[] = [];
  for (const project of open) {
    for (const deliverable of deps.deliverables.listFor(project.id)) {
      if (deliverable.status !== "shared") continue;
      attention.push({ key: `d-${deliverable.id}`, text: `Look at “${deliverable.title}”`, detail: `${project.name}. Approve it, or say what should change.`, href: `/portal/projects/${project.id}#deliverables`, action: "Open it" });
    }
  }
  for (const proposal of proposals) {
    if (proposal.status === "sent") attention.push({ key: `p-${proposal.id}`, text: `Answer the proposal “${proposal.title}”`, detail: "Read what it covers and what it costs, then accept or decline.", href: `/portal/proposals/${proposal.id}`, action: "Read it" });
  }
  for (const invoice of unpaid) {
    const due = invoice.dueOn ? ((daysUntil(invoice.dueOn, today) ?? 0) < 0 ? ` It was due ${friendlyDay(invoice.dueOn, today)}.` : ` Due ${dueText(invoice.dueOn, today)}.`) : "";
    attention.push({ key: `i-${invoice.id}`, text: `Pay invoice ${invoiceLabel(invoice.number)}: ${formatMoney({ minor: owedOn(invoice), currency: invoice.total.currency })}`, detail: `${invoice.projectName}.${due}`, href: "/portal#invoices", action: "How to pay" });
  }

  const latest = projects
    .flatMap((project) => deps.updates.listFor(project.id).filter((update) => !update.fromClient).map((update) => ({ update, project })))
    .sort((a, b) => (a.update.createdAt < b.update.createdAt ? 1 : -1))
    .slice(0, 3)
    .map(({ update, project }) => ({ id: update.id, body: clip(update.body, 280), projectId: project.id, projectName: project.name, who: update.authorName, when: deps.formatWhen(update.createdAt), whenIso: update.createdAt }));

  return {
    who: session.name,
    organizationName: deps.clients.get(session.organizationId)?.name ?? "",
    attention,
    projects: projects.map((project) => {
      const milestones = deps.milestones.listFor(project.id);
      const next = nextMilestone(milestones);
      const progress = milestoneProgress(milestones);
      return { id: project.id, name: project.name, ...standingOf(project), next: next ? stepText(next.name, next.dueOn, today) : "", done: progress.done, total: progress.total, steps: stepsDone(progress.done, progress.total) };
    }),
    latest,
    messageProjects: (open.length > 0 ? open : projects).map((project) => ({ id: project.id, name: project.name })),
    proposals: proposals.map((proposal) => ({ id: proposal.id, title: proposal.title, statusLabel: PROPOSAL_STATUS_LABELS[proposal.status] ?? proposal.status, waiting: proposal.status === "sent" })),
    invoices: [...invoices].reverse().map((invoice) => {
      const paid = invoice.status === "paid";
      return {
        id: invoice.id,
        label: invoiceLabel(invoice.number),
        projectName: invoice.projectName,
        paid,
        statusLabel: paid ? "Paid, thank you" : "Waiting for payment",
        total: formatMoney(invoice.total),
        owed: formatMoney({ minor: owedOn(invoice), currency: invoice.total.currency }),
        due: invoice.dueOn && !paid ? ((daysUntil(invoice.dueOn, today) ?? 0) < 0 ? `Was due ${friendlyDay(invoice.dueOn, today)}` : `Due ${dueText(invoice.dueOn, today)}`) : "",
      };
    }),
    owedTotal: owedMinor > 0 ? formatMoney({ minor: owedMinor, currency: unpaid[0]?.total.currency ?? "USD" }) : "",
    calls: deps.calls.listFor(session.organizationId).map((call) => ({ id: call.id, wanted: call.wanted, status: call.status, confirmedFor: call.confirmedFor ?? "", reply: call.reply, phone: call.phone })),
    people: deps.clientUsers
      .listFor(session.organizationId)
      .filter((user) => user.status === "active")
      .map((user) => user.name)
      .join(", "),
  };
}

export type PortalProjectView = {
  readonly project: { readonly id: string; readonly name: string; readonly description: string; readonly standing: string; readonly tone: string; readonly target: string; readonly open: boolean };
  readonly progress: { readonly done: number; readonly total: number; readonly text: string };
  readonly next: string;
  readonly steps: readonly { readonly id: string; readonly name: string; readonly when: string; readonly done: boolean; readonly overdue: boolean }[];
  readonly deliverables: readonly { readonly id: string; readonly title: string; readonly description: string; readonly fileId: string; readonly fileName: string; readonly status: string; readonly statusLabel: string; readonly decisionNote: string; readonly awaiting: boolean }[];
  readonly updates: readonly { readonly id: string; readonly body: string; readonly authorName: string; readonly fromClient: boolean; readonly when: string; readonly whenIso: string }[];
  /** Files the client sent in on this project, newest first. */
  readonly files: readonly { readonly id: string; readonly name: string; readonly size: string; readonly who: string; readonly when: string; readonly whenIso: string }[];
  /** What may be sent: "PDF, PNG, JPG ..." and the size limit. */
  readonly fileRules: string;
  /** Hours logged as billable on the project (docs/workflow.md, B6). Empty when there are none. */
  readonly billableHours: string;
};

// Said the way a client would: the full list of endings is long and means little to them.
const FILE_RULES = `Photos (JPG or PNG), PDFs, and Word or Excel files, up to ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB each.`;

export function portalProject(deps: PortalDeps, session: ClientSession, projectId: Id): Result<PortalProjectView, "not-found"> {
  const project = ownProject(deps, session, projectId);
  if (!project) return err("not-found");
  const today = deps.today();
  const milestones = deps.milestones.listFor(project.id);
  const next = nextMilestone(milestones);
  const progress = milestoneProgress(milestones);
  const billableMinutes = deps.time.totals(project.id, { from: "0000-01-01", to: "9999-12-31" }).billableMinutes;
  return ok({
    project: { id: project.id, name: project.name, description: project.description, ...standingOf(project), target: project.targetOn ? dueText(project.targetOn, today) : "", open: project.status === "active" },
    progress: { ...progress, text: stepsDone(progress.done, progress.total) },
    next: next ? stepText(next.name, next.dueOn, today) : "",
    steps: milestones.map((milestone) => {
      const overdue = isMilestoneOverdue(milestone, today);
      const when = milestone.doneOn !== null ? `Done ${friendlyDay(milestone.doneOn, today)}` : milestone.dueOn ? (overdue ? `Was due ${friendlyDay(milestone.dueOn, today)}, ${howSoon(milestone.dueOn, today)}` : dueText(milestone.dueOn, today)) : "No date yet";
      return { id: milestone.id, name: milestone.name, when, done: milestone.doneOn !== null, overdue };
    }),
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
    files: sentFiles(deps, project.id),
    fileRules: FILE_RULES,
    billableHours: billableMinutes > 0 ? formatHours(billableMinutes) : "",
  });
}

function sentFiles(deps: PortalDeps, projectId: Id) {
  return deps.files.listForOwner(CLIENT_UPLOAD, projectId).map((file) => ({ id: file.id, name: file.name, size: formatSize(file.sizeBytes), who: file.clientUserName ?? "", when: deps.formatWhen(file.createdAt), whenIso: file.createdAt }));
}

/**
 * The client sends a file on one of their own projects: photos, a menu, a
 * price list. The file service checks its type and size, and it is filed
 * under the client's own organization.
 */
export function sendFile(deps: PortalDeps, session: ClientSession, projectId: Id, upload: { readonly name: string; readonly bytes: Uint8Array } | null): Result<FileRecord, "not-found" | "project-closed" | "too-many-files" | "file-missing" | "file-too-large" | "file-name-invalid" | "file-type-not-allowed" | "file-content-mismatch"> {
  return deps.transact(() => {
    const project = ownProject(deps, session, projectId);
    if (!project) return err("not-found");
    if (project.status !== "active") return err("project-closed");
    return saveFileFromClient(deps, session, project.id, upload);
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
export function requestCall(deps: PortalDeps, session: ClientSession, input: { readonly wanted: string; readonly note?: string | null; readonly phone?: string | null }): Result<CallRequest, "wanted-missing" | "wanted-too-long" | "note-too-long" | "phone-invalid"> {
  const request = newCallRequest({ id: deps.newId(), organizationId: session.organizationId, clientUserId: session.clientUserId }, input);
  if (!request.ok) return request;
  return deps.transact(() => {
    deps.calls.insert(request.value, deps.clock());
    recordActivity(deps, { actorId: null, action: "call.requested", recordType: "call-request", recordId: request.value.id, context: { organizationId: session.organizationId, clientUserId: session.clientUserId } });
    return ok(request.value);
  });
}
