// Client requests (2026-11-26). A signed-in client sends one; it becomes a
// task (on a project of theirs) or a to-do (about them), for whoever looks
// after the client. They see where it stands. Anyone who works tasks sees
// them on the client's page and can say one isn't going ahead, with a
// reason the client reads.
import { readRequest, standing, STANDING_LABELS, type ClientRequest, type RequestError, type RequestStanding } from "../domain/request.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, friendlyDay, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";

export type RequestStore = {
  insert(request: ClientRequest): void;
  get(id: Id): ClientRequest | null;
  forClient(organizationId: Id): ClientRequest[];
  decline(id: Id, note: string, by: Id, at: string): void;
  /** How many arrived today or later, from this person: a limit on a runaway form. */
  countSince(clientUserId: Id, since: string): number;
};

export type RequestsDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly requests: RequestStore;
  readonly today: () => string;
  /** The client's open projects they may ask about: id and name. */
  readonly projectsOf: (organizationId: Id) => readonly { readonly id: Id; readonly name: string }[];
  /** Any project's name, open or finished. */
  readonly projectName: (projectId: Id) => string | null;
  /** Who looks after this client: the project's owner, or the client's. */
  readonly ownerFor: (organizationId: Id, projectId: Id | null) => Id | null;
  readonly makeTask: (input: { readonly projectId: Id | null; readonly organizationId: Id; readonly title: string; readonly description: string; readonly assigneeId: Id | null }) => Result<{ readonly id: Id }, string>;
  readonly taskStatus: (taskId: Id) => string | null;
  readonly clientName: (organizationId: Id) => string;
};

type Session = { readonly organizationId: Id; readonly clientUserId: Id; readonly name: string };
const PER_DAY = 20;

export type SendError = RequestError | "not-found" | "too-many-today" | "project-closed";

export function sendRequest(deps: RequestsDeps, session: Session, input: { readonly title: string; readonly details?: string | null; readonly projectId?: string | null }): Result<ClientRequest, SendError> {
  const read = readRequest(input);
  if (!read.ok) return read;
  const projectId = (input.projectId ?? "").trim() || null;
  if (projectId && !deps.projectsOf(session.organizationId).some((one) => one.id === projectId)) return err("not-found");
  return deps.transact(() => {
    if (deps.requests.countSince(session.clientUserId, `${deps.today()}T00:00:00`) >= PER_DAY) return err("too-many-today");
    const description = [`From ${session.name}, in the portal.`, read.value.details].filter(Boolean).join("\n\n");
    const task = deps.makeTask({ projectId: projectId as Id | null, organizationId: session.organizationId, title: read.value.title, description, assigneeId: deps.ownerFor(session.organizationId, projectId as Id | null) });
    if (!task.ok) return err(task.error === "project-closed" ? "project-closed" : "title-too-long");
    const request: ClientRequest = { id: deps.newId(), organizationId: session.organizationId, projectId: projectId as Id | null, clientUserId: session.clientUserId, title: read.value.title, details: read.value.details, taskId: task.value.id, declinedNote: "", declinedAt: null, createdAt: deps.clock() };
    deps.requests.insert(request);
    recordActivity(deps, { actorId: null, action: "request.received", recordType: "client", recordId: session.organizationId, context: { requestId: request.id, taskId: task.value.id, title: request.title, clientUserId: session.clientUserId, ...(projectId ? { projectId } : {}) } });
    return ok(request);
  });
}

export type RequestView = { readonly id: string; readonly title: string; readonly details: string; readonly project: string; readonly sent: string; readonly standing: RequestStanding; readonly standingLabel: string; readonly note: string; readonly taskHref: string; readonly open: boolean };

function view(deps: RequestsDeps, request: ClientRequest, projects: readonly { readonly id: Id; readonly name: string }[], staff: boolean): RequestView {
  const status = request.taskId ? deps.taskStatus(request.taskId) : null;
  const where = standing(request, status);
  return {
    id: request.id,
    title: request.title,
    details: request.details,
    project: projects.find((one) => one.id === request.projectId)?.name ?? (request.projectId ? (deps.projectName(request.projectId) ?? "A finished project") : ""),
    sent: friendlyDay(request.createdAt.slice(0, 10), deps.today()),
    standing: where,
    standingLabel: STANDING_LABELS[where],
    note: request.declinedNote,
    taskHref: staff && request.taskId ? (request.projectId ? `/tasks/${request.taskId}` : "/todos") : "",
    open: where !== "done" && where !== "not-going-ahead",
  };
}

/** The client's own requests, newest first, for the portal. */
export function portalRequests(deps: RequestsDeps, session: Session): { readonly items: readonly RequestView[]; readonly projects: readonly { readonly value: string; readonly label: string }[] } {
  const projects = deps.projectsOf(session.organizationId);
  return {
    items: deps.requests.forClient(session.organizationId).map((one) => view(deps, one, projects, false)),
    projects: [{ value: "", label: "Not about one project" }, ...projects.map((one) => ({ value: one.id, label: one.name }))],
  };
}

const may = (deps: RequestsDeps, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "task.edit").ok;
// Members do all client work (docs/authorization-matrix.md), so anyone who works tasks may answer a request.
const mayDecline = may;

/** A client's requests for their page in HQ. Empty for someone who can't work tasks. */
export function clientRequests(deps: RequestsDeps, actorId: Id | null, organizationId: Id): { readonly can: boolean; readonly canDecline: boolean; readonly items: readonly RequestView[] } {
  if (!may(deps, actorId)) return { can: false, canDecline: false, items: [] };
  const projects = deps.projectsOf(organizationId);
  return { can: true, canDecline: mayDecline(deps, actorId), items: deps.requests.forClient(organizationId).map((one) => view(deps, one, projects, true)) };
}

export function declineRequest(deps: RequestsDeps, actorId: Id | null, requestId: Id, note: string): Result<ClientRequest, "forbidden" | "not-found" | "decline-note-missing" | "decline-note-too-long" | "already-done"> {
  if (!mayDecline(deps, actorId)) return err("forbidden");
  const reason = note.trim();
  if (!reason) return err("decline-note-missing");
  if (reason.length > 300) return err("decline-note-too-long");
  return deps.transact(() => {
    const request = deps.requests.get(requestId);
    if (!request) return err("not-found");
    if (request.declinedAt || (request.taskId && deps.taskStatus(request.taskId) === "done")) return err("already-done");
    const at = deps.clock();
    deps.requests.decline(requestId, reason, actorId, at);
    recordActivity(deps, { actorId, action: "request.declined", recordType: "client", recordId: request.organizationId, context: { requestId, title: request.title, note: reason } });
    return ok({ ...request, declinedNote: reason, declinedAt: at });
  });
}
