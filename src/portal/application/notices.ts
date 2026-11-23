// Telling people that something happened in the portal.
//
// Two directions. When a client acts (a message, a file, a decision, an
// answer, a call request), the person at Potomac who owns that work is
// emailed, and it shows on the dashboard. When Potomac leaves something for
// a client (a deliverable, a proposal, an invoice, an update), the client
// can be emailed that something is waiting.
//
// Both are read from the activity log, which every change already writes.
// So nothing that makes a change knows about email, and nothing can be
// changed without the notice sender seeing it.
import { CLIENT_ACTIONS, clientEmail, FOR_CLIENT_ACTIONS, staffEmail, type StaffLine } from "../domain/notices.ts";
import { parseId, recordActivity, type Id } from "../../shared/index.ts";
import type { LoggedEvent } from "./ports.ts";
import type { PortalDeps } from "./staff-side.ts";
import { authorize } from "../../identity/index.ts";

const idIn = (event: LoggedEvent, key: string): Id | null => {
  const value = event.context[key];
  const parsed = typeof value === "string" ? parseId(value) : null;
  return parsed && parsed.ok ? parsed.value : null;
};
const asId = (text: string): Id | null => {
  const parsed = parseId(text);
  return parsed.ok ? parsed.value : null;
};

type Described = StaffLine & { readonly ownerId: Id | null };

/** What a client did, in words, with where to go and whose work it is. Null when it is not something a client did. */
function describe(deps: PortalDeps, event: LoggedEvent): Described | null {
  const clientUserId = idIn(event, "clientUserId");
  if (!clientUserId || !(CLIENT_ACTIONS as readonly string[]).includes(event.action)) return null;
  const user = deps.clientUsers.get(clientUserId);
  if (!user) return null;
  const who = user.name;
  const organization = deps.clients.get(user.organizationId)?.name ?? "";
  const onProject = (projectId: Id | null, did: (name: string) => string, anchor: string): Described | null => {
    const project = projectId ? deps.projects.get(projectId) : null;
    return project ? { who, organization, did: did(project.name), path: `/projects/${project.id}#${anchor}`, ownerId: project.ownerId } : null;
  };
  switch (event.action) {
    case "project.message-received":
      return onProject(asId(event.recordId), (name) => `sent a message on ${name}`, "updates");
    case "file.received-from-client":
      return onProject(idIn(event, "projectId"), (name) => `sent a file on ${name}`, "client-files");
    case "deliverable.approved":
      return onProject(idIn(event, "projectId"), (name) => `approved a deliverable on ${name}`, "deliverables");
    case "deliverable.changes-requested":
      return onProject(idIn(event, "projectId"), (name) => `asked for changes to a deliverable on ${name}`, "deliverables");
    case "proposal.accepted-in-portal":
    case "proposal.declined-in-portal": {
      const proposalId = asId(event.recordId);
      const proposal = proposalId ? deps.proposals.get(proposalId) : null;
      if (!proposal) return null;
      const opportunity = deps.opportunities.get(proposal.opportunityId);
      return { who, organization, did: `${event.action === "proposal.accepted-in-portal" ? "accepted" : "declined"} the proposal “${opportunity?.title ?? "untitled"}”`, path: `/proposals/${proposal.id}`, ownerId: opportunity?.ownerId ?? null };
    }
    case "change-request.approved":
    case "change-request.declined":
      return onProject(idIn(event, "projectId"), (name) => `${event.action === "change-request.approved" ? "approved" : "declined"} a change on ${name}`, "changes");
    case "call.requested":
      return { who, organization, did: "asked for a call", path: `/clients/${user.organizationId}#portal`, ownerId: null };
    default:
      return null;
  }
}

export type ClientActivityView = { readonly canView: boolean; readonly items: readonly { readonly id: string; readonly text: string; readonly href: string; readonly when: string; readonly whenIso: string }[] };

/** What clients did in the portal in the last two weeks, newest first. For the dashboard. */
export function clientActivity(deps: PortalDeps, actorId: Id | null): ClientActivityView {
  if (actorId === null || !authorize(deps, actorId, "portal.view").ok) return { canView: false, items: [] };
  const since = Temporal.Instant.from(deps.clock()).subtract({ hours: 24 * 14 }).toString();
  const items = deps.events
    .recent(CLIENT_ACTIONS, since, 40)
    .flatMap((event) => {
      const line = describe(deps, event);
      return line ? [{ id: event.id, text: `${line.who}${line.organization ? ` (${line.organization})` : ""} ${line.did}`, href: line.path, when: deps.formatWhen(event.occurredAt), whenIso: event.occurredAt }] : [];
    })
    .slice(0, 10);
  return { canView: true, items };
}

/** The organization a "for the client" event is about, or null. */
function organizationOf(deps: PortalDeps, event: LoggedEvent): Id | null {
  switch (event.action) {
    case "deliverable.shared":
    case "change-request.sent":
    case "invoice.sent":
    case "milestone.given-to-client": {
      const projectId = idIn(event, "projectId");
      return (projectId ? deps.projects.get(projectId)?.organizationId : null) ?? null;
    }
    case "project.update-posted": {
      const projectId = asId(event.recordId);
      return (projectId ? deps.projects.get(projectId)?.organizationId : null) ?? null;
    }
    case "proposal.shared": {
      const proposalId = asId(event.recordId);
      const proposal = proposalId ? deps.proposals.get(proposalId) : null;
      // A draft that is shared shows nothing yet: only a sent proposal is in the portal.
      if (!proposal || proposal.status !== "sent") return null;
      return deps.opportunities.get(proposal.opportunityId)?.organizationId ?? null;
    }
    case "call.confirmed":
    case "call.declined":
      return idIn(event, "organizationId");
    default:
      return null;
  }
}

export type Mail = (message: { readonly to: string; readonly subject: string; readonly body: string }) => Promise<boolean>;

export type NoticeOptions = {
  /** The address people use, for links. */
  readonly publicUrl: string;
  /** Whether clients are emailed. Potomac's own people always are. */
  readonly toClients: boolean;
  /** Potomac's phone number, for the client's email. */
  readonly phone: string;
};

export type NoticeResult = { readonly read: number; readonly toStaff: number; readonly toClients: number; readonly failed: number };

/**
 * Reads what was written to the activity log since the last run and sends
 * the notices it calls for. Run it every minute or so.
 *
 * The place in the log is moved forward before anything is sent. If HQ
 * stops halfway, a notice is lost and never sent twice: two emails about
 * one thing is the worse mistake. Several events for one person in one run
 * are one email.
 *
 * HQ does this by itself, so there is no permission to check. It writes an
 * activity event with how many it sent.
 */
export async function sendNotices(deps: PortalDeps, mail: Mail, options: NoticeOptions): Promise<NoticeResult> {
  const staff = new Map<string, { name: string; lines: StaffLine[] }>();
  const clients = new Map<Id, string[]>();
  const read = deps.transact(() => {
    const events = deps.events.after(deps.events.cursor(), 500);
    const last = events.at(-1);
    if (!last) return 0;
    const admins = () => deps.users.list().filter((user) => user.status === "active" && deps.users.rolesOf(user.id).includes("admin"));
    for (const event of events) {
      const line = describe(deps, event);
      if (line) {
        const owner = line.ownerId ? deps.users.get(line.ownerId) : null;
        for (const person of owner && owner.status === "active" ? [owner] : admins()) {
          const entry = staff.get(person.email) ?? { name: person.name, lines: [] };
          entry.lines.push(line);
          staff.set(person.email, entry);
        }
      }
      const kind = FOR_CLIENT_ACTIONS[event.action];
      const organizationId = kind && options.toClients ? organizationOf(deps, event) : null;
      if (kind && organizationId) clients.set(organizationId, [...(clients.get(organizationId) ?? []), kind]);
    }
    deps.events.setCursor(last.position, deps.clock());
    return events.length;
  });
  if (read === 0) return { read: 0, toStaff: 0, toClients: 0, failed: 0 };

  let toStaff = 0;
  let toClients = 0;
  let failed = 0;
  const send = async (to: string, message: { subject: string; body: string }): Promise<boolean> => {
    try {
      if (await mail({ to, ...message })) return true;
    } catch {
      // Counted below. One address that fails does not stop the rest.
    }
    failed += 1;
    return false;
  };
  for (const [email, entry] of staff) if (await send(email, staffEmail(entry.name, entry.lines, options.publicUrl))) toStaff += 1;
  for (const [organizationId, kinds] of clients) {
    const organization = deps.clients.get(organizationId)?.name ?? "your business";
    for (const person of deps.clientUsers.noticeRecipients(organizationId)) {
      if (await send(person.email, clientEmail({ name: person.name, organization, kinds, publicUrl: options.publicUrl, phone: options.phone }))) toClients += 1;
    }
  }
  if (toStaff + toClients + failed > 0) {
    deps.transact(() => {
      recordActivity(deps, { actorId: null, action: failed > 0 && toStaff + toClients === 0 ? "notice.failed" : "notice.sent", recordType: "notice", recordId: deps.newId(), context: { toStaff, toClients, failed } });
    });
  }
  return { read, toStaff, toClients, failed };
}
