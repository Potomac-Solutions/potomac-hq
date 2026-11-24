// A comment on a task (decision 0007, section 6). Anyone who can see the task
// may comment. Unlike a note, the author may edit or delete their own
// comment; an edited comment says so, and the task's history keeps every
// version and the deletion, in its events. `@name` in a comment mentions that
// person; telling them comes with reminders and notices (section 8).
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";
import { handleOf } from "./quick-add.ts";

export const COMMENT_MAX = 5000;

export type Comment = {
  readonly id: Id;
  readonly taskId: Id;
  readonly authorId: Id;
  readonly body: string;
  readonly createdAt: string;
  /** When it was last edited, or null. */
  readonly editedAt: string | null;
};

export type CommentError = "comment-empty" | "comment-too-long";

function checkBody(text: string): Result<string, CommentError> {
  const body = text.trim();
  if (body.length === 0) return err("comment-empty");
  if (body.length > COMMENT_MAX) return err("comment-too-long");
  return ok(body);
}

export function newComment(id: Id, taskId: Id, authorId: Id, text: string, at: string): Result<Comment, CommentError> {
  const body = checkBody(text);
  return body.ok ? ok({ id, taskId, authorId, body: body.value, createdAt: at, editedAt: null }) : body;
}

export function editComment(comment: Comment, text: string, at: string): Result<Comment, CommentError | "unchanged"> {
  const body = checkBody(text);
  if (!body.ok) return body;
  if (body.value === comment.body) return err("unchanged");
  return ok({ ...comment, body: body.value, editedAt: at });
}

/** Only its author edits or deletes a comment. No role overrides that. */
export const mayChangeComment = (comment: Pick<Comment, "authorId">, actorId: Id): boolean => comment.authorId === actorId;

/** The handles mentioned with "@", as handles, once each and in order. An email address is not a mention. */
export function mentionsIn(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(/(^|[^\p{L}\p{N}_.@])@([\p{L}\p{N}][\p{L}\p{N}_.\-]*[\p{L}\p{N}]|[\p{L}\p{N}])/gu)) {
    const handle = handleOf(match[2] as string);
    if (handle && !found.includes(handle)) found.push(handle);
  }
  return found;
}

export type CommentPiece = { readonly text: string; readonly mention: boolean };

/** The body cut into plain text and mentions, for drawing mentions apart. Only `known` handles count. */
export function commentPieces(body: string, known: ReadonlySet<string>): CommentPiece[] {
  const pieces: CommentPiece[] = [];
  let from = 0;
  for (const match of body.matchAll(/(^|[^\p{L}\p{N}_.@])(@([\p{L}\p{N}][\p{L}\p{N}_.\-]*[\p{L}\p{N}]|[\p{L}\p{N}]))/gu)) {
    if (!known.has(handleOf(match[3] as string))) continue;
    const start = (match.index ?? 0) + (match[1] as string).length;
    if (start > from) pieces.push({ text: body.slice(from, start), mention: false });
    pieces.push({ text: match[2] as string, mention: true });
    from = start + (match[2] as string).length;
  }
  if (from < body.length) pieces.push({ text: body.slice(from), mention: false });
  return pieces;
}
