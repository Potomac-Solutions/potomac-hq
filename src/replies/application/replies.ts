// Saved replies (quality of life, 2026-11-25). Anyone who may write to
// clients (`contact.edit`) sees, adds, changes and removes them; each change
// is recorded.
import { readReply, type Reply, type ReplyError } from "../domain/reply.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";

export type ReplyStore = {
  list(): Reply[];
  get(id: Id): Reply | null;
  insert(reply: Reply, by: Id, at: string): void;
  update(reply: Reply, at: string): void;
  remove(id: Id, at: string): boolean;
};

export type RepliesDeps = ActivityDeps & { readonly users: IdentityUserStore; readonly transact: Transact; readonly replies: ReplyStore };

const may = (deps: RepliesDeps, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "contact.edit").ok;

export const listReplies = (deps: RepliesDeps, actorId: Id | null): readonly Reply[] => (may(deps, actorId) ? deps.replies.list() : []);

export function saveReply(deps: RepliesDeps, actorId: Id | null, id: Id | null, input: { readonly title: string; readonly body: string }): Result<Reply, "forbidden" | "not-found" | ReplyError> {
  if (!may(deps, actorId)) return err("forbidden");
  const read = readReply(input);
  if (!read.ok) return read;
  return deps.transact(() => {
    if (id !== null && !deps.replies.get(id)) return err("not-found");
    const reply: Reply = { id: id ?? deps.newId(), ...read.value };
    if (id === null) deps.replies.insert(reply, actorId, deps.clock());
    else deps.replies.update(reply, deps.clock());
    recordActivity(deps, { actorId, action: id === null ? "reply.added" : "reply.changed", recordType: "saved-reply", recordId: reply.id as Id, context: { title: reply.title } });
    return ok(reply);
  });
}

export function removeReply(deps: RepliesDeps, actorId: Id | null, id: Id): Result<true, "forbidden" | "not-found"> {
  if (!may(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    if (!deps.replies.remove(id, deps.clock())) return err("not-found");
    recordActivity(deps, { actorId, action: "reply.removed", recordType: "saved-reply", recordId: id, context: {} });
    return ok(true as const);
  });
}
