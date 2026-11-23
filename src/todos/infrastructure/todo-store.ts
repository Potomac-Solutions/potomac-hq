import type { Todo } from "../domain/todo.ts";
import type { TodoStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const COLUMNS = "id, title, due_on, assignee_id, organization_id, opportunity_id, done_at, created_by";
const ORDER = "order by due_on is null, due_on, created_at";

function toTodo(row: Record<string, unknown>): Todo {
  return {
    id: row["id"] as Id,
    title: String(row["title"]),
    dueOn: (row["due_on"] as string | null) ?? null,
    assigneeId: row["assignee_id"] as Id,
    organizationId: (row["organization_id"] as Id | null) ?? null,
    opportunityId: (row["opportunity_id"] as Id | null) ?? null,
    doneAt: (row["done_at"] as string | null) ?? null,
    createdBy: row["created_by"] as Id,
  };
}

export function sqliteTodoStore(db: Database): TodoStore {
  const insert = db.prepare(`insert into todo (${COLUMNS}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare("update todo set title = ?, due_on = ?, assignee_id = ?, done_at = ?, updated_at = ? where id = ?");
  const get = db.prepare(`select ${COLUMNS} from todo where id = ?`);
  const openFor = db.prepare(`select ${COLUMNS} from todo where assignee_id = ? and done_at is null ${ORDER}`);
  const allOpen = db.prepare(`select ${COLUMNS} from todo where done_at is null ${ORDER}`);
  const doneSince = db.prepare(`select ${COLUMNS} from todo where assignee_id = ? and done_at >= ? order by done_at desc`);
  const atClient = db.prepare(`select ${COLUMNS} from todo where organization_id = ? and done_at is null ${ORDER}`);
  const onOpportunity = db.prepare(`select ${COLUMNS} from todo where opportunity_id = ? and done_at is null ${ORDER}`);
  return {
    insert(t, at) {
      insert.run(t.id, t.title, t.dueOn, t.assigneeId, t.organizationId, t.opportunityId, t.doneAt, t.createdBy, at, at);
    },
    update(t, at) {
      update.run(t.title, t.dueOn, t.assigneeId, t.doneAt, at, t.id);
    },
    get(id) {
      const row = get.get(id);
      return row ? toTodo(row) : null;
    },
    openFor: (assigneeId) => openFor.all(assigneeId).map(toTodo),
    allOpen: () => allOpen.all().map(toTodo),
    doneSince: (assigneeId, since) => doneSince.all(assigneeId, since).map(toTodo),
    openAtClient: (organizationId) => atClient.all(organizationId).map(toTodo),
    openOnOpportunity: (opportunityId) => onOpportunity.all(opportunityId).map(toTodo),
  };
}
