// What HQ's own users do about the portal: invite a client, turn their access
// off, post an update for them to read, and answer a call request. Each one
// checks permission first and writes its activity event.
import { answerCall, newClientUser, newUpdate, setAccess, type CallRequest, type ClientUser, type InviteError, type ProjectUpdate } from "../domain/client-user.ts";
import { CLIENT_UPLOAD, formatSize } from "../../files/index.ts";
import type { FinanceDeps } from "../../finance/index.ts";
import { authorize } from "../../identity/index.ts";
import type { ProposalsDeps } from "../../proposals/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { CallStore, ClientUserStore, PortalAuth, UpdateStore } from "./ports.ts";

export type PortalDeps = ProposalsDeps &
  FinanceDeps & {
    readonly clientUsers: ClientUserStore;
    readonly updates: UpdateStore;
    readonly calls: CallStore;
    readonly auth: PortalAuth;
  };

export type Refused = "forbidden" | "not-found";

function allowed(deps: PortalDeps, actorId: Id | null, action: string): actorId is Id {
  return actorId !== null && authorize(deps, actorId, action).ok;
}
const may = (deps: PortalDeps, actorId: Id | null, action: string): boolean => actorId !== null && authorize(deps, actorId, action).ok;

/** A one-time link for a client: the address they open to choose their password. */
export type PortalLink = { readonly user: ClientUser; readonly path: string };

/**
 * Invites someone at a client to the portal. They belong to that client from
 * then on. The answer carries a one-time link: the caller emails it, or shows
 * it to the inviter once. The link itself is never written to the audit log.
 */
export async function inviteClientUser(deps: PortalDeps, actorId: Id | null, organizationId: Id, input: { readonly name: string; readonly email: string }): Promise<Result<PortalLink, Refused | InviteError | "already-invited">> {
  if (!allowed(deps, actorId, "portal.manage")) return err("forbidden");
  if (!deps.clients.get(organizationId)) return err("not-found");
  const user = newClientUser({ id: deps.newId(), organizationId, invitedBy: actorId }, input);
  if (!user.ok) return user;
  if (deps.clientUsers.byEmail(user.value.email)) return err("already-invited");
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

/** Turns a client's portal access off, ending their sessions at once, or back on. */
export async function setClientAccess(deps: PortalDeps, actorId: Id | null, clientUserId: Id, on: boolean): Promise<Result<ClientUser, Refused | "unchanged">> {
  if (!allowed(deps, actorId, "portal.manage")) return err("forbidden");
  const user = deps.clientUsers.get(clientUserId);
  if (!user) return err("not-found");
  const changed = setAccess(user, on);
  if (!changed.ok) return changed;
  if (user.portalAccount !== null) await deps.auth.setDisabled(user.portalAccount, !on);
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
