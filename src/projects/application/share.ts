// Sharing a project by link (decision 0007, section 11).
//
// Making and stopping links needs `project.share` (admin and manager). A
// link is reached by its secret alone, with no account: it sees the
// project's phases, milestones, tasks with their status and due dates, and
// shared deliverables, and with "comment" rights it can comment on tasks
// under a name the visitor types. It never sees internal notes, time,
// estimates, money, who has a task, the team's own comments, or any other
// project. Every visit, comment and download through it is recorded.
import { newGuestComment, type CommentError } from "../domain/comment.ts";
import { isClientVisible } from "../domain/deliverable.ts";
import { DELIVERABLE_STATUS_LABELS, TASK_STATUS_LABELS } from "../domain/labels.ts";
import { guestName, newShareLink, shareState, type ShareError, type ShareLink } from "../domain/share.ts";
import { formatSize } from "../../files/index.ts";
import { authorize } from "../../identity/index.ts";
import { dueText, err, friendlyDay, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { ProjectsDeps, Refused } from "./commands.ts";

const mayShare = (deps: ProjectsDeps, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "project.share").ok;

export type ShareLinksView = {
  readonly canShare: boolean;
  readonly links: readonly {
    readonly id: string;
    readonly label: string;
    readonly rights: string;
    readonly state: string;
    readonly live: boolean;
    readonly expires: string;
    readonly made: string;
    readonly visits: string;
  }[];
};

const STATE_TEXT = { live: "Working", stopped: "Stopped", expired: "Expired" } as const;
const RIGHTS_TEXT = { see: "See", comment: "See and comment" } as const;

/** A project's links, for the people who manage them; nothing for anyone else. */
export function shareLinks(deps: ProjectsDeps, actorId: Id | null, projectId: Id): ShareLinksView {
  if (!mayShare(deps, actorId)) return { canShare: false, links: [] };
  const today = deps.today();
  return {
    canShare: true,
    links: deps.shares.forProject(projectId).map((link) => {
      const state = shareState(link, today);
      return {
        id: link.id,
        label: link.label,
        rights: RIGHTS_TEXT[link.rights],
        state: STATE_TEXT[state],
        live: state === "live",
        expires: link.expiresOn ? `Through ${friendlyDay(link.expiresOn, today)}` : "Until stopped",
        made: `${link.createdByName}, ${deps.formatWhen(link.createdAt)}`,
        visits: link.visits === 0 ? "Not opened yet" : `${link.visits} ${link.visits === 1 ? "visit" : "visits"}, last ${deps.formatWhen(link.lastVisitedAt ?? link.createdAt)}`,
      };
    }),
  };
}

/** Makes a link. Answers its secret, to be shown once. */
export function makeShareLink(
  deps: ProjectsDeps,
  actorId: Id | null,
  projectId: Id,
  input: { readonly label: string; readonly rights: string; readonly expiresOn?: string | null },
): Result<{ readonly token: string; readonly link: ShareLink }, Refused | "project-closed" | ShareError> {
  if (!mayShare(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const project = deps.projects.get(projectId);
    if (!project) return err("not-found");
    if (project.status !== "active") return err("project-closed");
    const made = newShareLink({ id: deps.newId(), projectId, createdBy: actorId, createdAt: deps.clock() }, input, deps.today());
    if (!made.ok) return made;
    const token = deps.feedTokens.newToken();
    deps.shares.insert(made.value, deps.feedTokens.hash(token));
    recordActivity(deps, { actorId, action: "project.share-made", recordType: "project", recordId: projectId, context: { projectId, shareId: made.value.id, label: made.value.label, rights: made.value.rights, ...(made.value.expiresOn ? { expiresOn: made.value.expiresOn } : {}) } });
    return ok({ token, link: made.value });
  });
}

export function stopShareLink(deps: ProjectsDeps, actorId: Id | null, shareId: Id): Result<ShareLink, Refused | "already-stopped"> {
  if (!mayShare(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const link = deps.shares.get(shareId);
    if (!link) return err("not-found");
    if (link.stoppedAt !== null) return err("already-stopped");
    deps.shares.stop(shareId, actorId, deps.clock());
    recordActivity(deps, { actorId, action: "project.share-stopped", recordType: "project", recordId: link.projectId, context: { projectId: link.projectId, shareId, label: link.label } });
    return ok(link);
  });
}

/** The live link a secret opens, with its project, or null. */
function openLink(deps: ProjectsDeps, token: string): { readonly link: ShareLink; readonly project: { readonly id: Id; readonly name: string; readonly clientName: string } } | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const link = deps.shares.byHash(deps.feedTokens.hash(token));
  if (!link || shareState(link, deps.today()) !== "live") return null;
  const project = deps.projects.list().find((one) => one.id === link.projectId);
  return project ? { link, project: { id: project.id, name: project.name, clientName: project.clientName } } : null;
}

export type SharedTask = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly done: boolean;
  readonly due: string;
  readonly overdue: boolean;
  readonly comments: readonly { readonly id: string; readonly name: string; readonly when: string; readonly body: string }[];
};

export type SharedProjectView = {
  readonly projectName: string;
  readonly clientName: string;
  readonly label: string;
  readonly canComment: boolean;
  readonly expires: string;
  readonly groups: readonly {
    readonly key: string;
    readonly name: string;
    readonly milestones: readonly { readonly id: string; readonly name: string; readonly due: string; readonly done: boolean }[];
    readonly tasks: readonly SharedTask[];
  }[];
  readonly deliverables: readonly { readonly id: string; readonly title: string; readonly description: string; readonly status: string; readonly href: string; readonly size: string }[];
};

/** What a link shows. Records the visit. Null for anything that isn't a working link. */
export function sharedProject(deps: ProjectsDeps, token: string): SharedProjectView | null {
  const opened = openLink(deps, token);
  if (!opened) return null;
  const { link, project } = opened;
  const today = deps.today();
  deps.transact(() => {
    deps.shares.visited(link.id, deps.clock());
    recordActivity(deps, { actorId: null, action: "project.share-visited", recordType: "project", recordId: project.id, context: { projectId: project.id, shareId: link.id, label: link.label } });
  });
  const said = new Map<string, SharedTask["comments"][number][]>();
  if (link.rights === "comment") {
    for (const comment of deps.comments.fromLinks(project.id)) {
      said.set(comment.taskId, [...(said.get(comment.taskId) ?? []), { id: comment.id, name: comment.authorName, when: deps.formatWhen(comment.createdAt), body: comment.body }]);
    }
  }
  const tasks = deps.tasks.listFor(project.id);
  const milestones = deps.milestones.listFor(project.id);
  const group = (key: string, name: string, phaseId: Id | null) => ({
    key,
    name,
    milestones: milestones
      .filter((one) => one.phaseId === phaseId)
      .map((one) => ({ id: one.id, name: one.name, due: one.dueOn ? dueText(one.dueOn, today) : "No date yet", done: one.doneOn !== null })),
    tasks: tasks
      .filter((task) => task.phaseId === phaseId)
      .map((task) => ({
        id: task.id,
        title: task.title,
        status: TASK_STATUS_LABELS[task.status] ?? task.status,
        done: task.status === "done",
        due: task.dueOn ? dueText(task.dueOn, today) : "",
        overdue: task.status !== "done" && task.dueOn !== null && task.dueOn < today,
        comments: said.get(task.id) ?? [],
      })),
  });
  const phases = deps.phases.listFor(project.id);
  const groups = [...phases.map((phase) => group(phase.id, phase.name, phase.id)), group("none", phases.length > 0 ? "Everything else" : "The work", null)].filter((one) => one.milestones.length + one.tasks.length > 0);
  return {
    projectName: project.name,
    clientName: project.clientName,
    label: link.label,
    canComment: link.rights === "comment",
    expires: link.expiresOn ? `This link works through ${friendlyDay(link.expiresOn, today)}.` : "",
    groups,
    deliverables: deps.deliverables
      .listFor(project.id)
      .filter(isClientVisible)
      .map((one) => ({ id: one.id, title: one.title, description: one.description, status: DELIVERABLE_STATUS_LABELS[one.status] ?? one.status, href: `/s/${token}/files/${one.fileId}`, size: formatSize(one.fileSize) })),
  };
}

/** A comment through a link with comment rights, under the name the visitor typed. */
export function commentThroughLink(
  deps: ProjectsDeps,
  token: string,
  taskId: Id,
  input: { readonly name: string; readonly body: string },
): Result<{ readonly taskId: Id }, "not-found" | "may-not-comment" | "guest-name-missing" | "guest-name-too-long" | CommentError> {
  const opened = openLink(deps, token);
  if (!opened) return err("not-found");
  if (opened.link.rights !== "comment") return err("may-not-comment");
  const name = guestName(input.name);
  if (!name.ok) return name;
  return deps.transact(() => {
    const task = deps.tasks.get(taskId);
    if (!task || task.projectId !== opened.project.id) return err("not-found");
    const made = newGuestComment(deps.newId(), taskId, opened.link.id, name.value, input.body, deps.clock());
    if (!made.ok) return made;
    deps.comments.insert(made.value);
    recordActivity(deps, {
      actorId: null,
      action: "comment.added",
      recordType: "task",
      recordId: taskId,
      context: { projectId: opened.project.id, title: task.title, commentId: made.value.id, body: made.value.body, mentions: [], shareId: opened.link.id, guestName: name.value },
    });
    return ok({ taskId });
  });
}

/** A shared deliverable's file, through a working link. Null for anything else. The download is recorded. */
export function fileThroughLink(deps: ProjectsDeps, token: string, fileId: Id): { readonly name: string; readonly contentType: string; readonly body: Uint8Array } | null {
  const opened = openLink(deps, token);
  if (!opened) return null;
  const deliverable = deps.deliverables.listFor(opened.project.id).find((one) => one.fileId === fileId && isClientVisible(one));
  const record = deliverable ? deps.files.get(fileId) : null;
  const body = record ? deps.blobs.get(fileId) : null;
  if (!record || !body) return null;
  deps.transact(() => recordActivity(deps, { actorId: null, action: "file.downloaded", recordType: "file", recordId: fileId, context: { name: record.name, by: "share-link", shareId: opened.link.id } }));
  return { name: record.name, contentType: record.contentType, body };
}
