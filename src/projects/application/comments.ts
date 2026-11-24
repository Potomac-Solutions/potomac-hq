// Comments and attachments on tasks (decision 0007, section 6).
//
// Anyone with `task.view` may comment. Only a comment's author edits or
// deletes it. Every version and the deletion are kept as events on the task,
// so its history has them all. Mentions ("@sam") are worked out here and
// recorded with the event; telling the person comes with notices (section 8).
//
// Files attach to a task as to a deliverable: through the files module, with
// its type checks, `file.upload` to send and `file.download` to fetch.
import { editComment, mayChangeComment, mentionsIn, newComment, type Comment, type CommentError } from "../domain/comment.ts";
import { matchHandle } from "../domain/quick-add.ts";
import { removeFile, saveFile, type UploadError } from "../../files/index.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { ProjectsDeps, Refused } from "./commands.ts";

const allowed = (deps: ProjectsDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;

/** What a person may be called in a mention: full name, first name, and the name part of their email. */
export const mentionNames = (user: { readonly name: string; readonly email: string }): string[] => [user.name, user.name.split(/\s+/)[0] ?? "", user.email.split("@")[0] ?? ""];

/** The people a comment mentions: each handle that means exactly one active person. */
export function mentionedPeople(deps: ProjectsDeps, body: string): Id[] {
  const people = deps.users.list().filter((user) => user.status === "active");
  const ids: Id[] = [];
  for (const handle of mentionsIn(body)) {
    const found = matchHandle(handle, people, mentionNames);
    if (found.length === 1 && !ids.includes((found[0] as (typeof people)[number]).id)) ids.push((found[0] as (typeof people)[number]).id);
  }
  return ids;
}

export function addTaskComment(deps: ProjectsDeps, actorId: Id | null, taskId: Id, body: string): Result<Comment, Refused | CommentError> {
  if (!allowed(deps, actorId, "task.view")) return err("forbidden");
  return deps.transact(() => {
    const task = deps.tasks.get(taskId);
    if (!task) return err("not-found");
    const made = newComment(deps.newId(), taskId, actorId, body, deps.clock());
    if (!made.ok) return made;
    deps.comments.insert(made.value);
    recordActivity(deps, {
      actorId,
      action: "comment.added",
      recordType: "task",
      recordId: taskId,
      context: { projectId: task.projectId, title: task.title, commentId: made.value.id, body: made.value.body, mentions: mentionedPeople(deps, made.value.body) },
    });
    return ok(made.value);
  });
}

/** Only the author. The old words stay in the event. */
export function editTaskComment(deps: ProjectsDeps, actorId: Id | null, commentId: Id, body: string): Result<Comment, Refused | CommentError | "unchanged"> {
  if (!allowed(deps, actorId, "task.view")) return err("forbidden");
  return deps.transact(() => {
    const comment = deps.comments.get(commentId);
    if (!comment) return err("not-found");
    if (!mayChangeComment(comment, actorId)) return err("forbidden");
    const edited = editComment(comment, body, deps.clock());
    if (!edited.ok) return edited;
    deps.comments.update(edited.value);
    const before = new Set(mentionedPeople(deps, comment.body));
    recordActivity(deps, {
      actorId,
      action: "comment.edited",
      recordType: "task",
      recordId: comment.taskId,
      context: { projectId: deps.tasks.get(comment.taskId)?.projectId ?? null, commentId, was: comment.body, body: edited.value.body, mentions: mentionedPeople(deps, edited.value.body).filter((id) => !before.has(id)) },
    });
    return ok(edited.value);
  });
}

/** Only the author. The words stay in the event. */
export function removeTaskComment(deps: ProjectsDeps, actorId: Id | null, commentId: Id): Result<Comment, Refused> {
  if (!allowed(deps, actorId, "task.view")) return err("forbidden");
  return deps.transact(() => {
    const comment = deps.comments.get(commentId);
    if (!comment) return err("not-found");
    if (!mayChangeComment(comment, actorId)) return err("forbidden");
    deps.comments.remove(commentId);
    recordActivity(deps, { actorId, action: "comment.removed", recordType: "task", recordId: comment.taskId, context: { projectId: deps.tasks.get(comment.taskId)?.projectId ?? null, commentId, was: comment.body } });
    return ok(comment);
  });
}

/** Attaches a file to a task. `task.edit` here; the files module checks `file.upload` and the file's type. */
export function attachToTask(deps: ProjectsDeps, actorId: Id | null, taskId: Id, file: { readonly name: string; readonly bytes: Uint8Array } | null): Result<{ readonly taskId: Id }, Refused | UploadError> {
  if (!allowed(deps, actorId, "task.edit")) return err("forbidden");
  return deps.transact(() => {
    const task = deps.tasks.get(taskId);
    if (!task) return err("not-found");
    const saved = saveFile(deps, actorId, file ? { ...file, ownerType: "task", ownerId: taskId, organizationId: deps.comments.organizationOf(taskId), projectId: task.projectId } : null);
    if (!saved.ok) return saved;
    recordActivity(deps, { actorId, action: "task.file-attached", recordType: "task", recordId: taskId, context: { projectId: task.projectId, title: task.title, fileId: saved.value.id, name: saved.value.name } });
    return ok({ taskId });
  });
}

/** Removes a file from a task, bytes and all. The same permission as attaching one. */
export function removeTaskFile(deps: ProjectsDeps, actorId: Id | null, taskId: Id, fileId: Id): Result<{ readonly taskId: Id; readonly name: string }, Refused> {
  if (!allowed(deps, actorId, "task.edit")) return err("forbidden");
  return deps.transact(() => {
    const task = deps.tasks.get(taskId);
    const record = deps.files.get(fileId);
    // Only this task's own files: a deliverable's or a receipt's file can't be removed through a task.
    if (!task || !record || record.ownerType !== "task" || record.ownerId !== taskId) return err("not-found");
    const removed = removeFile(deps, actorId, record, task.projectId);
    if (!removed.ok) return removed;
    recordActivity(deps, { actorId, action: "task.file-removed", recordType: "task", recordId: taskId, context: { projectId: task.projectId, title: task.title, fileId, name: record.name } });
    return ok({ taskId, name: record.name });
  });
}
