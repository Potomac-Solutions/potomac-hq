// What HQ's own users do about the portal: invite a client, turn their access
// off, post an update for them to read, and answer a call request. Each one
// checks permission first and writes its activity event.
import { answerCall, mayAddClient, newClientUser, newUpdate, opensAnyClient, setAccess, type CallRequest, type ClientSession, type ClientUser, type InviteError, type ProjectUpdate } from "../domain/client-user.ts";
import { CLIENT_UPLOAD, formatSize } from "../../files/index.ts";
import type { FinanceDeps } from "../../finance/index.ts";
import { authorize } from "../../identity/index.ts";
import type { ProposalsDeps } from "../../proposals/index.ts";
import { dueText, err, formatMoney, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { CallStore, ClientUserStore, EventReader, PeopleLookup, PortalAuth, UpdateStore } from "./ports.ts";

export type PortalDeps = ProposalsDeps &
  FinanceDeps & {
    readonly clientUsers: ClientUserStore;
    readonly updates: UpdateStore;
    readonly calls: CallStore;
    readonly auth: PortalAuth;
    readonly events: EventReader;
    /** Finds someone already on file by email or phone, so one person can't sign up twice. */
    readonly people?: PeopleLookup;
  };

export type Refused = "forbidden" | "not-found";

function allowed(deps: PortalDeps, actorId: Id | null, action: string): actorId is Id {
  return actorId !== null && authorize(deps, actorId, action).ok;
}
const may = (deps: PortalDeps, actorId: Id | null, action: string): boolean => actorId !== null && authorize(deps, actorId, action).ok;

/**
 * Seeing a client person's portal as they see it (decision 0020), read-only,
 * for an admin or manager checking a feature or helping on a call. The client
 * is not told. Answers the session to show the portal with, or null when this
 * person may not or the client person can't be previewed. Asked on every
 * request, so taking someone's access away ends their previews at once.
 */
export function previewSession(deps: PortalDeps, actorId: Id | null, clientUserId: Id): ClientSession | null {
  if (!may(deps, actorId, "portal.manage") || !may(deps, actorId, "client.view")) return null;
  const user = deps.clientUsers.get(clientUserId);
  // Someone invited but not signed in yet can be previewed: that is how to check a portal before they first see it.
  if (!user || user.status === "disabled") return null;
  return { clientUserId: user.id, organizationId: user.organizationId, name: user.name, previewedBy: actorId as Id };
}

/** Starts a preview of a client person's portal, and logs it. */
export function startPortalPreview(deps: PortalDeps, actorId: Id | null, clientUserId: Id): Result<ClientSession, Refused | "access-off"> {
  if (!allowed(deps, actorId, "portal.manage") || !may(deps, actorId, "client.view")) return err("forbidden");
  const user = deps.clientUsers.get(clientUserId);
  if (!user) return err("not-found");
  if (user.status === "disabled") return err("access-off");
  deps.transact(() => recordActivity(deps, { actorId, action: "client-user.portal-preview-started", recordType: "client-user", recordId: user.id, context: { organizationId: user.organizationId } }));
  return ok({ clientUserId: user.id, organizationId: user.organizationId, name: user.name, previewedBy: actorId });
}

/** Ends a preview, and logs it. Anyone may stop their own; there is nothing to refuse. */
export function stopPortalPreview(deps: PortalDeps, actorId: Id | null, clientUserId: Id | null): void {
  const user = clientUserId ? deps.clientUsers.get(clientUserId) : null;
  if (actorId === null || !user) return;
  deps.transact(() => recordActivity(deps, { actorId, action: "client-user.portal-preview-stopped", recordType: "client-user", recordId: user.id, context: { organizationId: user.organizationId } }));
}

/** What the portal's banner says during a preview: whose portal, at which client. */
export function previewBanner(deps: PortalDeps, session: ClientSession | null): { readonly name: string; readonly clientName: string; readonly clientId: Id } | null {
  if (!session?.previewedBy) return null;
  return { name: session.name, clientName: deps.clients.get(session.organizationId)?.name ?? "", clientId: session.organizationId };
}

/** A one-time link for a client: the address they open to choose their password. */
export type PortalLink = { readonly user: ClientUser; readonly path: string };
/** An invite: a link to send, or null when they already sign in to the portal at another client (decision 0022). */
export type Invited = { readonly user: ClientUser; readonly path: string | null };

/**
 * Invites someone at a client to the portal. They belong to that client from
 * then on. Someone already in the portal at another client is given this one
 * too only if they are listed as a contact here (decision 0022), and signs in
 * with the password they have: then there's no link (`path` is null), and the
 * client is in their portal at once, or opens with the invite they already have.
 * Otherwise the answer carries a one-time link: the caller emails it, or shows
 * it to the inviter once. The link itself is never written to the audit log.
 */
export async function inviteClientUser(deps: PortalDeps, actorId: Id | null, organizationId: Id, input: { readonly name: string; readonly email: string }): Promise<Result<Invited, Refused | InviteError | "already-invited" | "not-a-contact">> {
  if (!allowed(deps, actorId, "portal.manage")) return err("forbidden");
  if (!deps.clients.get(organizationId)) return err("not-found");
  const user = newClientUser({ id: deps.newId(), organizationId, invitedBy: actorId }, input);
  if (!user.ok) return user;
  const existing = deps.clientUsers.allByEmail(user.value.email);
  const isContact = deps.contacts.listFor(organizationId).some((contact) => contact.email !== null && contact.email.toLowerCase() === user.value.email);
  const may = mayAddClient(existing, organizationId, isContact);
  if (!may.ok) return may;
  if (existing.length > 0) {
    // Their sign-in, if they have one, opens this client too; an invite not yet used will open it when it is.
    const joined = may.value.account === null ? user.value : { ...user.value, portalAccount: may.value.account, status: "active" as const };
    // A sign-in shut because every client it opened was turned off opens again, for this client only.
    if (joined.portalAccount !== null && !opensAnyClient(existing)) await deps.auth.setDisabled(joined.portalAccount, false);
    deps.transact(() => {
      deps.clientUsers.insert(joined, deps.clock());
      recordActivity(deps, { actorId, action: "client-user.invited", recordType: "client-user", recordId: joined.id, context: { organizationId, alsoAt: existing.length } });
    });
    return ok({ user: joined, path: null });
  }
  const token = await deps.auth.invite(user.value.email, user.value.name);
  if (token === null) return err("already-invited");
  deps.transact(() => {
    deps.clientUsers.insert(user.value, deps.clock());
    recordActivity(deps, { actorId, action: "client-user.invited", recordType: "client-user", recordId: user.value.id, context: { organizationId } });
  });
  return ok({ user: user.value, path: `/portal/accept?token=${token}` });
}

/** A fresh one-time link: a new invite for someone who never accepted, a password link for someone who did. */
export async function issuePortalLink(deps: PortalDeps, actorId: Id | null, clientUserId: Id): Promise<Result<PortalLink, Refused | "access-off">> {
  if (!allowed(deps, actorId, "portal.manage")) return err("forbidden");
  const user = deps.clientUsers.get(clientUserId);
  if (!user) return err("not-found");
  if (user.status === "disabled") return err("access-off");
  const token = user.portalAccount === null ? await deps.auth.invite(user.email, user.name) : await deps.auth.resetLink(user.portalAccount);
  if (token === null) return err("not-found");
  deps.transact(() => {
    recordActivity(deps, { actorId, action: "client-user.reset-link-issued", recordType: "client-user", recordId: user.id, context: { organizationId: user.organizationId, kind: user.portalAccount === null ? "invite" : "reset" } });
  });
  return ok({ user, path: `/portal/accept?token=${token}` });
}

/**
 * Turns a person's portal access at this client off, or back on. Off ends it
 * at this client at once (every request checks). Their sign-in itself is shut,
 * ending their sessions, only when no other client is open to them; their
 * access at other clients is untouched (decision 0022).
 */
export async function setClientAccess(deps: PortalDeps, actorId: Id | null, clientUserId: Id, on: boolean): Promise<Result<ClientUser, Refused | "unchanged">> {
  if (!allowed(deps, actorId, "portal.manage")) return err("forbidden");
  const user = deps.clientUsers.get(clientUserId);
  if (!user) return err("not-found");
  const changed = setAccess(user, on);
  if (!changed.ok) return changed;
  if (user.portalAccount !== null) {
    const others = deps.clientUsers.allByAccount(user.portalAccount).filter((one) => one.id !== user.id);
    if (!opensAnyClient(others)) await deps.auth.setDisabled(user.portalAccount, !on);
  }
  deps.transact(() => {
    deps.clientUsers.update(changed.value, deps.clock());
    recordActivity(deps, { actorId, action: "client-user.status-changed", recordType: "client-user", recordId: user.id, context: { organizationId: user.organizationId, from: user.status, to: changed.value.status } });
  });
  return ok(changed.value);
}

/** Posts an update on a project. The client reads it in the portal. */
export function postProjectUpdate(deps: PortalDeps, actorId: Id | null, projectId: Id, body: string): Result<ProjectUpdate, Refused | "message-empty" | "message-too-long"> {
  if (!allowed(deps, actorId, "project.post-update")) return err("forbidden");
  return deps.transact(() => {
    if (!deps.projects.get(projectId)) return err("not-found");
    const update = newUpdate({ id: deps.newId(), projectId, userId: actorId, clientUserId: null }, body, deps.clock());
    if (!update.ok) return update;
    deps.updates.insert(update.value);
    recordActivity(deps, { actorId, action: "project.update-posted", recordType: "project", recordId: projectId, context: { updateId: update.value.id } });
    return ok(update.value);
  });
}

export function answerCallRequest(
  deps: PortalDeps,
  actorId: Id | null,
  requestId: Id,
  input: { readonly answer: string; readonly confirmedFor?: string | null; readonly reply?: string | null },
): Result<CallRequest, Refused | "already-answered" | "invalid-answer" | "when-missing" | "when-too-long" | "reply-too-long"> {
  if (!allowed(deps, actorId, "call.respond")) return err("forbidden");
  return deps.transact(() => {
    const request = deps.calls.get(requestId);
    if (!request) return err("not-found");
    const answered = answerCall(request, input, actorId);
    if (!answered.ok) return answered;
    deps.calls.update(answered.value, deps.clock());
    recordActivity(deps, { actorId, action: answered.value.status === "confirmed" ? "call.confirmed" : "call.declined", recordType: "call-request", recordId: requestId, context: { organizationId: request.organizationId, confirmedFor: answered.value.confirmedFor } });
    return ok(answered.value);
  });
}

const ACCESS_LABELS: Readonly<Record<string, string>> = { invited: "Invited, not signed in yet", active: "Has access", disabled: "Access turned off" };

export type CallView = { readonly id: string; readonly who: string; readonly clientId: string; readonly clientName: string; readonly wanted: string; readonly note: string; readonly phone: string; readonly status: string; readonly confirmedFor: string; readonly reply: string; readonly when: string };

function callView(deps: PortalDeps, call: import("./ports.ts").CallRow): CallView {
  return { id: call.id, who: call.clientUserName, clientId: call.organizationId, clientName: call.organizationName, wanted: call.wanted, note: call.note, phone: call.phone, status: call.status, confirmedFor: call.confirmedFor ?? "", reply: call.reply, when: deps.formatWhen(call.createdAt) };
}

export type PortalAccessView = {
  readonly canView: boolean;
  readonly canManage: boolean;
  readonly users: readonly { readonly id: string; readonly name: string; readonly email: string; readonly status: string; readonly statusLabel: string }[];
  readonly calls: readonly CallView[];
  readonly canRespond: boolean;
};

/** A client's portal users and call requests, for the client's page. Without `portal.view` the panel is not shown. */
export function portalAccess(deps: PortalDeps, actorId: Id | null, organizationId: Id): PortalAccessView {
  if (!may(deps, actorId, "portal.view") || !may(deps, actorId, "client.view")) return { canView: false, canManage: false, users: [], calls: [], canRespond: false };
  return {
    canView: true,
    canManage: may(deps, actorId, "portal.manage"),
    users: deps.clientUsers.listFor(organizationId).map((user) => ({ id: user.id, name: user.name, email: user.email, status: user.status, statusLabel: ACCESS_LABELS[user.status] ?? user.status })),
    calls: deps.calls.listFor(organizationId).map((call) => callView(deps, call)),
    canRespond: may(deps, actorId, "call.respond"),
  };
}

export type ProjectUpdatesView = {
  readonly canView: boolean;
  readonly canPost: boolean;
  readonly items: readonly { readonly id: string; readonly body: string; readonly authorName: string; readonly fromClient: boolean; readonly when: string; readonly whenIso: string }[];
};

/** A project's updates and the client's messages, for the project's page. */
export function projectUpdates(deps: PortalDeps, actorId: Id | null, projectId: Id): ProjectUpdatesView {
  if (!may(deps, actorId, "project.view")) return { canView: false, canPost: false, items: [] };
  return {
    canView: true,
    canPost: may(deps, actorId, "project.post-update"),
    items: deps.updates.listFor(projectId).map((update) => ({ id: update.id, body: update.body, authorName: update.authorName, fromClient: update.fromClient, when: deps.formatWhen(update.createdAt), whenIso: update.createdAt })),
  };
}

/** The dashboard's panel: calls clients have asked for that nobody has answered. */
export function callsWaiting(deps: PortalDeps, actorId: Id | null): Result<{ readonly items: readonly CallView[] }, "forbidden"> {
  if (!may(deps, actorId, "call.respond")) return err("forbidden");
  return ok({ items: deps.calls.waiting().map((call) => callView(deps, call)) });
}

export type ClientFilesView = { readonly canView: boolean; readonly items: readonly { readonly id: string; readonly name: string; readonly size: string; readonly who: string; readonly when: string; readonly whenIso: string }[] };

/** Files the client sent in on a project. For anyone who may see the project and download files. */
export function clientFiles(deps: PortalDeps, actorId: Id | null, projectId: Id): ClientFilesView {
  if (!may(deps, actorId, "project.view") || !may(deps, actorId, "file.download")) return { canView: false, items: [] };
  return {
    canView: true,
    items: deps.files.listForOwner(CLIENT_UPLOAD, projectId).map((file) => ({ id: file.id, name: file.name, size: formatSize(file.sizeBytes), who: file.clientUserName ?? "The client", when: deps.formatWhen(file.createdAt), whenIso: file.createdAt })),
  };
}

/** One thing a client is waiting on Potomac for, with where to go to do it. */
export type StaffWaitingItem = { readonly key: string; readonly text: string; readonly detail: string; readonly href: string; readonly action: string; readonly since: string };

/**
 * The top of the dashboard: what clients are waiting on Potomac for. A
 * message nobody has answered, changes asked for on a deliverable, a call
 * to confirm, a drafted invoice to send, and an invoice past its due day.
 * Each part shows only to someone who may act on it.
 */
export function staffWaiting(deps: PortalDeps, actorId: Id | null): { readonly items: readonly StaffWaitingItem[] } {
  if (actorId === null) return { items: [] };
  const today = deps.today();
  const items: StaffWaitingItem[] = [];
  const active = deps.projects.list().filter((project) => project.status === "active");

  if (may(deps, actorId, "project.post-update")) {
    for (const project of active) {
      // Newest first: if the newest word on a project is the client's, it is waiting for an answer.
      const latest = deps.updates.listFor(project.id)[0];
      if (latest?.fromClient) items.push({ key: `u-${latest.id}`, text: `Answer ${latest.authorName} on ${project.name}`, detail: `${project.clientName}. Their message is the last word on the project.`, href: `/projects/${project.id}#updates`, action: "Reply", since: latest.createdAt });
    }
  }
  if (may(deps, actorId, "deliverable.edit")) {
    for (const project of active) {
      for (const deliverable of deps.deliverables.listFor(project.id)) {
        if (deliverable.status !== "changes-requested") continue;
        items.push({ key: `d-${deliverable.id}`, text: `Changes asked for on “${deliverable.title}”`, detail: `${project.name}, ${project.clientName}${deliverable.decisionNote ? `: “${deliverable.decisionNote.slice(0, 120)}”` : "."}`, href: `/projects/${project.id}#deliverables`, action: "Open", since: "" });
      }
    }
  }
  if (may(deps, actorId, "call.respond")) {
    for (const call of deps.calls.waiting()) {
      items.push({ key: `c-${call.id}`, text: `Call ${call.clientUserName} back`, detail: `${call.organizationName}. Wants: ${call.wanted}${call.phone ? `. On ${call.phone}` : ""}.`, href: `/clients/${call.organizationId}#portal`, action: "Answer", since: call.createdAt });
    }
  }
  if (may(deps, actorId, "invoice.edit")) {
    for (const invoice of deps.invoices.list()) {
      const label = `INV-${String(invoice.number).padStart(4, "0")}`;
      if (invoice.status === "draft") {
        items.push({ key: `i-${invoice.id}`, text: `Send invoice ${label}`, detail: `${invoice.projectName ? `${invoice.projectName}, ` : ""}${invoice.clientName}. ${formatMoney(invoice.total)}, still a draft.`, href: `/invoices/${invoice.id}`, action: "Check and send", since: "" });
      } else if (invoice.status === "sent" && invoice.dueOn !== null && invoice.dueOn < today) {
        items.push({ key: `i-${invoice.id}`, text: `Invoice ${label} is past due`, detail: `${invoice.projectName ? `${invoice.projectName}, ` : ""}${invoice.clientName}. ${formatMoney({ minor: invoice.total.minor - invoice.paidMinor, currency: invoice.total.currency })} owed, due ${dueText(invoice.dueOn, today)}.`, href: `/invoices/${invoice.id}`, action: "Open", since: "" });
      }
    }
  }
  return { items };
}
