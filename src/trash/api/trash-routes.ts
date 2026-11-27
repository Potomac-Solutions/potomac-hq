// The Trash's forms (decision 0023): deleting from the page that asked first,
// putting back, deleting forever and emptying the Trash.
import { Hono } from "hono";
import { deleteRecords, purgeFromTrash, restoreFromTrash, type TrashDeps } from "../application/trash.ts";
import { formPosts, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that. Only an admin can delete, put back or empty the Trash.",
  "not-found": "That’s already gone.",
  nothing: "Tick at least one first.",
  "too-many": "Delete up to 100 at a time.",
  "has-money": "Nothing was deleted: a real client’s payments and signed agreements stay. Mark it Former instead, or a demo if it was only ever a test.",
  "cant-delete": "That couldn’t be deleted: something else still depends on it. Nothing was changed.",
  conflict: "That couldn’t be put back: something now takes its place, like a contact with the same email. Nothing was changed.",
  "bad-kind": "That can’t be deleted here.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

/** Where to go after a delete: a page of HQ's own, never another site. */
const safeBack = (value: string | undefined): string => (value && /^\/[a-z]/.test(value) && !value.includes("//") && !value.includes("\\") ? value : "/trash");
const idsOf = (value: string | undefined): string[] => (value ?? "").split(",");

export function trashRoutes(deps: { readonly trash: TrashDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/trash" });

  post("/delete", (actor, f) => deleteRecords(deps.trash, actor, f["kind"] ?? "", idsOf(f["ids"])), {
    done: (_, __, f) => safeBack(f["back"]),
    back: (_, f) => safeBack(f["back"]),
    message: (result) => `${result.message} It can be put back from the Trash for 30 days.`,
    undo: (result) => ({ label: result.message, action: "/trash/restore", fields: { ids: result.trashIds.join(",") } }),
  });
  post("/trash/restore", (actor, f) => restoreFromTrash(deps.trash, actor, idsOf(f["ids"])), {
    done: () => "/trash",
    back: () => "/trash",
    message: (result) => result.message,
  });
  post("/trash/purge", (actor, f) => purgeFromTrash(deps.trash, actor, idsOf(f["ids"])), {
    done: () => "/trash",
    back: () => "/trash",
    message: "Deleted for good.",
  });
  post("/trash/empty", (actor) => purgeFromTrash(deps.trash, actor, "all"), {
    done: () => "/trash",
    back: () => "/trash",
    message: (result) => `The Trash is empty. ${result.purged} deleted for good.`,
  });
  return app;
}
