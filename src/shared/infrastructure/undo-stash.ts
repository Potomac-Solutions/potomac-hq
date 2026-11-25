// Undo (decision 0014). The post that reverses a change is kept here, and the
// page that follows carries only its token, so old values of any length fit
// and nothing in an address can say what an undo posts.
import { randomBytes } from "node:crypto";
import type { Database } from "./database.ts";

export type UndoStash = {
  /** Keeps a post and answers its token. Clears ones older than a day. */
  keep(action: string, fields: Readonly<Record<string, string>>): string;
  /** The post for a token, once: it is gone after this. Null when unknown or older than a day. */
  take(token: string): { readonly action: string; readonly fields: Readonly<Record<string, string>> } | null;
};

const DAY_MS = 24 * 60 * 60_000;

export function sqliteUndoStash(db: Database, clock: () => string): UndoStash {
  const insert = db.prepare("insert into undo_stash (token, action, fields, created_at) values (?, ?, ?, ?)");
  const clear = db.prepare("delete from undo_stash where created_at < ?");
  const find = db.prepare("select action, fields, created_at from undo_stash where token = ?");
  const remove = db.prepare("delete from undo_stash where token = ?");
  const dayBefore = (at: string) => new Date(Date.parse(at) - DAY_MS).toISOString();
  return {
    keep(action, fields) {
      const at = clock();
      const token = randomBytes(16).toString("hex");
      clear.run(dayBefore(at));
      insert.run(token, action, JSON.stringify(fields), at);
      return token;
    },
    take(token) {
      if (!/^[0-9a-f]{32}$/.test(token)) return null;
      const row = find.get(token) as { action: string; fields: string; created_at: string } | undefined;
      if (!row) return null;
      remove.run(token);
      if (row.created_at < dayBefore(clock())) return null;
      const parsed = JSON.parse(row.fields) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
      const fields = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      return { action: row.action, fields };
    },
  };
}
