// To-dos live in the task table as tasks without a project (migration 0041).
// The open and done lists also hold project tasks, so My work is one list.
import type { Todo } from "../domain/todo.ts";
import type { TodoRow, TodoStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const COLUMNS = `t.id, t.title, t.due_on, t.assignee_id, coalesce(t.organization_id, p.organization_id) as organization_id, t.opportunity_id,
  t.done_at, t.created_by, t.project_id, coalesce(p.name, '') as project_name`;
const FROM = "from task t left join project p on p.id = t.project_id";
/** Open: not done, and either a to-do or a task of an active project. */
const OPEN = "t.status <> 'done' and (t.project_id is null or p.status = 'active')";
const ORDER = "order by t.due_on is null, t.due_on, t.created_at";

function toRow(row: Record<string, unknown>): TodoRow {
  return {
    id: row["id"] as Id,
    title: String(row["title"]),
    dueOn: (row["due_on"] as string | null) ?? null,
    assigneeId: row["assignee_id"] as Id,
    organizationId: (row["organization_id"] as Id | null) ?? null,
    opportunityId: (row["opportunity_id"] as Id | null) ?? null,
    doneAt: (row["done_at"] as string | null) ?? null,
    createdBy: (row["created_by"] as Id | null) ?? null,
    projectId: (row["project_id"] as Id | null) ?? null,
    projectName: String(row["project_name"] ?? ""),
  };
}

export function sqliteTodoStore(db: Database): TodoStore {
  const insert = db.prepare(`insert into task (id, project_id, phase_id, title, description, assignee_id, priority, due_on, estimate_minutes, status, done_at, organization_id, opportunity_id, created_by, created_at, updated_at)
    values (?, null, null, ?, '', ?, 'normal', ?, null, ?, ?, ?, ?, ?, ?, ?)`);
  // Only a to-do's own fields; a project task is changed through the projects module.
  const update = db.prepare("update task set title = ?, due_on = ?, assignee_id = ?, status = ?, done_at = ?, updated_at = ? where id = ? and project_id is null");
  const get = db.prepare(`select ${COLUMNS} ${FROM} where t.id = ?`);
  const openFor = db.prepare(`select ${COLUMNS} ${FROM} where t.assignee_id = ? and ${OPEN} ${ORDER}`);
  const allOpen = db.prepare(`select ${COLUMNS} ${FROM} where t.assignee_id is not null and ${OPEN} ${ORDER}`);
  const doneSince = db.prepare(`select ${COLUMNS} ${FROM} where t.assignee_id = ? and t.done_at >= ? order by t.done_at desc`);
  const atClient = db.prepare(`select ${COLUMNS} ${FROM} where t.project_id is null and t.organization_id = ? and t.status <> 'done' ${ORDER}`);
  const onOpportunity = db.prepare(`select ${COLUMNS} ${FROM} where t.project_id is null and t.opportunity_id = ? and t.status <> 'done' ${ORDER}`);
  const status = (t: Todo) => (t.doneAt === null ? "todo" : "done");
  return {
    insert(t, at) {
      insert.run(t.id, t.title, t.assigneeId, t.dueOn, status(t), t.doneAt, t.organizationId, t.opportunityId, t.createdBy, at, at);
    },
    update(t, at) {
      update.run(t.title, t.dueOn, t.assigneeId, status(t), t.doneAt, at, t.id);
    },
    get(id) {
      const row = get.get(id);
      return row ? toRow(row) : null;
    },
    openFor: (assigneeId) => openFor.all(assigneeId).map(toRow),
    allOpen: () => allOpen.all().map(toRow),
    doneSince: (assigneeId, since) => doneSince.all(assigneeId, since).map(toRow),
    openAtClient: (organizationId) => atClient.all(organizationId).map(toRow),
    openOnOpportunity: (opportunityId) => onOpportunity.all(opportunityId).map(toRow),
  };
}
