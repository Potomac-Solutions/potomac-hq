// The assistant's conversations, actions and preferences (migration 0073).
import type { Ask, Block } from "../domain/assistant.ts";
import type { ActionStatus, AssistantStore, StoredAction, StoredMessage, Undo } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

function toAction(row: Record<string, unknown>): StoredAction {
  return {
    id: row["id"] as Id,
    userId: row["user_id"] as Id,
    toolUseId: String(row["tool_use_id"]),
    ask: { ...(JSON.parse(String(row["input"])) as object), tool: String(row["tool"]) } as Ask,
    summary: String(row["summary"]),
    status: row["status"] as ActionStatus,
    href: String(row["href"] ?? ""),
    problem: String(row["problem"] ?? ""),
    undo: row["undo"] ? (JSON.parse(String(row["undo"])) as Undo) : null,
    createdAt: String(row["created_at"]),
    decidedAt: (row["decided_at"] as string | null) ?? null,
  };
}

export function sqliteAssistantStore(db: Database): AssistantStore {
  const messages = db.prepare("select id, role, blocks, at from assistant_message where user_id = ? and archived = 0 order by at, rowid");
  const addMessage = db.prepare("insert into assistant_message (id, user_id, role, blocks, at) values (?, ?, ?, ?, ?)");
  const archive = db.prepare("update assistant_message set archived = 1 where user_id = ? and archived = 0");
  const addAction = db.prepare("insert into assistant_action (id, user_id, tool_use_id, tool, input, summary, status, href, problem, undo, created_at, decided_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const action = db.prepare("select * from assistant_action where id = ?");
  const actionsOf = db.prepare("select * from assistant_action where user_id = ? and tool_use_id in (select value from json_each(?))");
  const settle = db.prepare("update assistant_action set status = ?, href = coalesce(?, href), problem = coalesce(?, problem), undo = case when ? then ? else undo end, decided_at = ? where id = ?");
  const autoSmall = db.prepare("select auto_small from assistant_preference where user_id = ?");
  const setAutoSmall = db.prepare("insert into assistant_preference (user_id, auto_small, updated_at) values (?, ?, ?) on conflict (user_id) do update set auto_small = excluded.auto_small, updated_at = excluded.updated_at");
  return {
    messages: (userId) =>
      messages.all(userId).map((row): StoredMessage => ({ id: row["id"] as Id, role: row["role"] as StoredMessage["role"], content: JSON.parse(String(row["blocks"])) as Block[], at: String(row["at"]) })),
    addMessage(userId, message) {
      addMessage.run(message.id, userId, message.role, JSON.stringify(message.content), message.at);
    },
    archive: (userId) => Number(archive.run(userId).changes),
    addAction(a) {
      const { tool, ...input } = a.ask;
      addAction.run(a.id, a.userId, a.toolUseId, tool, JSON.stringify(input), a.summary, a.status, a.href, a.problem, a.undo ? JSON.stringify(a.undo) : null, a.createdAt, a.decidedAt);
    },
    action(id) {
      const row = action.get(id);
      return row ? toAction(row) : null;
    },
    actionsFor: (userId, toolUseIds) => (toolUseIds.length === 0 ? [] : actionsOf.all(userId, JSON.stringify(toolUseIds)).map(toAction)),
    settle(id, change) {
      const hasUndo = change.undo !== undefined;
      settle.run(change.status, change.href ?? null, change.problem ?? null, hasUndo ? 1 : 0, hasUndo && change.undo ? JSON.stringify(change.undo) : null, change.at, id);
    },
    autoSmall: (userId) => Number(autoSmall.get(userId)?.["auto_small"] ?? 0) === 1,
    setAutoSmall(userId, on, at) {
      setAutoSmall.run(userId, on ? 1 : 0, at);
    },
  };
}
