// Undo (decision 0014). The post that reverses a change is kept here, and the
// page that follows carries only its token, so old values of any length fit
// and nothing in an address can say what an undo posts. A token is claimed by
// the person whose page shows it; after that only they may use it, and it is
// listed in their Recent changes until it's used or a day old.
import { randomBytes } from "node:crypto";
import type { Database } from "./database.ts";

export type KeptUndo = { readonly action: string; readonly fields: Readonly<Record<string, string>> };
export type RecentChange = { readonly token: string; readonly label: string; readonly at: string };

export type UndoStash = {
  /** Keeps a post and answers its token. Clears ones older than a day. */
  keep(action: string, fields: Readonly<Record<string, string>>, label?: string): string;
  /** Marks a token as this person's, unless it is already someone's. Answers its label, or "" when it can't be used by them. */
  claim(token: string, userId: string): string;
  /**
   * The post for a token, once: it is gone after this. Null when unknown,
   * older than a day, or claimed by someone else.
   */
  take(token: string, userId: string | null): KeptUndo | null;
  /** This person's changes that can still be undone, newest first: one per thing changed (the newest). */
  recent(userId: string, limit?: number): readonly RecentChange[];
};

const DAY_MS = 24 * 60 * 60_000;
const TOKEN = /^[0-9a-f]{32}$/;

export function sqliteUndoStash(db: Database, clock: () => string): UndoStash {
  const insert = db.prepare("insert into undo_stash (token, action, fields, label, created_at) values (?, ?, ?, ?, ?)");
  const clear = db.prepare("delete from undo_stash where created_at < ?");
  const own = db.prepare("update undo_stash set user_id = ? where token = ? and user_id is null");
  const labelFor = db.prepare("select label from undo_stash where token = ? and user_id = ?");
  const find = db.prepare("select action, fields, user_id, created_at from undo_stash where token = ?");
  const remove = db.prepare("delete from undo_stash where token = ?");
  const mine = db.prepare("select token, action, label, created_at from undo_stash where user_id = ? and created_at >= ? order by created_at desc, rowid desc limit 200");
  const dayBefore = (at: string) => new Date(Date.parse(at) - DAY_MS).toISOString();
  return {
    keep(action, fields, label = "") {
      const at = clock();
      const token = randomBytes(16).toString("hex");
      clear.run(dayBefore(at));
      insert.run(token, action, JSON.stringify(fields), label.slice(0, 300), at);
      return token;
    },
    claim(token, userId) {
      if (!TOKEN.test(token)) return "";
      own.run(userId, token);
      return (labelFor.get(token, userId) as { label: string } | undefined)?.label ?? "";
    },
    take(token, userId) {
      if (!TOKEN.test(token)) return null;
      const row = find.get(token) as { action: string; fields: string; user_id: string | null; created_at: string } | undefined;
      if (!row) return null;
      if (row.user_id !== null && row.user_id !== userId) return null;
      remove.run(token);
      if (row.created_at < dayBefore(clock())) return null;
      const parsed = JSON.parse(row.fields) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
      const fields = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      return { action: row.action, fields };
    },
    recent(userId, limit = 30) {
      const rows = mine.all(userId, dayBefore(clock())) as { token: string; action: string; label: string; created_at: string }[];
      // An older undo of the same thing would put back something a newer change already replaced.
      const seen = new Set<string>();
      const list: RecentChange[] = [];
      for (const row of rows) {
        if (seen.has(row.action)) continue;
        seen.add(row.action);
        list.push({ token: row.token, label: row.label || "A change", at: row.created_at });
        if (list.length >= limit) break;
      }
      return list;
    },
  };
}
