import type { DeliverableStore, MilestoneStore, PhaseStore, ProjectHistory, ProjectRow, ProjectStore, TaskRow, TaskStore, DeliverableRow, HistoryRow } from "../application/ports.ts";
import type { Deliverable, DeliverableStatus } from "../domain/deliverable.ts";
import type { Milestone, Phase } from "../domain/plan.ts";
import type { Project, ProjectHealth, ProjectKind, ProjectStatus } from "../domain/project.ts";
import type { Task, TaskPriority, TaskStatus } from "../domain/task.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

type Row = Record<string, string | number | null>;
const text = (row: Row, key: string) => row[key] as string;
const maybe = (row: Row, key: string) => (row[key] ?? null) as string | null;

const toProject = (r: Row): Project => ({
  id: text(r, "id") as Id,
  organizationId: text(r, "organization_id") as Id,
  opportunityId: text(r, "opportunity_id") as Id,
  ownerId: text(r, "owner_id") as Id,
  name: text(r, "name"),
  kind: text(r, "kind") as ProjectKind,
  status: text(r, "status") as ProjectStatus,
  description: text(r, "description"),
  health: text(r, "health") as ProjectHealth,
  startOn: maybe(r, "start_on"),
  targetOn: maybe(r, "target_on"),
});

export function sqliteProjectStore(db: Database): ProjectStore {
  const columns = "id, organization_id, opportunity_id, owner_id, name, kind, status, description, health, start_on, target_on";
  const insert = db.prepare(`insert into project (${columns}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare("update project set owner_id = ?, name = ?, status = ?, description = ?, health = ?, start_on = ?, target_on = ?, updated_at = ? where id = ?");
  const byId = db.prepare(`select ${columns} from project where id = ?`);
  const byOpportunity = db.prepare(`select ${columns} from project where opportunity_id = ?`);
  const listFor = db.prepare(`select ${columns} from project where organization_id = ? order by created_at desc, rowid desc`);
  const list = db.prepare(
    `select ${columns.split(", ").map((c) => `p.${c}`).join(", ")}, c.name as client_name, u.name as owner_name,
            (select count(*) from task t where t.project_id = p.id and t.status <> 'done') as open_tasks
       from project p
       join client_organization c on c.id = p.organization_id
       join user u on u.id = p.owner_id
      order by p.created_at desc, p.rowid desc`,
  );
  return {
    insert(p, at) {
      insert.run(p.id, p.organizationId, p.opportunityId, p.ownerId, p.name, p.kind, p.status, p.description, p.health, p.startOn, p.targetOn, at, at);
    },
    update(p, at) {
      update.run(p.ownerId, p.name, p.status, p.description, p.health, p.startOn, p.targetOn, at, p.id);
    },
    get(id) {
      const row = byId.get(id) as Row | undefined;
      return row ? toProject(row) : null;
    },
    byOpportunity(id) {
      const row = byOpportunity.get(id) as Row | undefined;
      return row ? toProject(row) : null;
    },
    list() {
      return (list.all() as Row[]).map((r): ProjectRow => ({ ...toProject(r), clientName: text(r, "client_name"), ownerName: text(r, "owner_name"), openTasks: r["open_tasks"] as number }));
    },
    listFor(organizationId) {
      return (listFor.all(organizationId) as Row[]).map(toProject);
    },
  };
}

const toPhase = (r: Row): Phase => ({ id: text(r, "id") as Id, projectId: text(r, "project_id") as Id, name: text(r, "name"), position: r["position"] as number });

export function sqlitePhaseStore(db: Database): PhaseStore {
  const insert = db.prepare("insert into phase (id, project_id, name, position, created_at, updated_at) values (?, ?, ?, ?, ?, ?)");
  const get = db.prepare("select id, project_id, name, position from phase where id = ?");
  const listFor = db.prepare("select id, project_id, name, position from phase where project_id = ? order by position, rowid");
  return {
    insert(p, at) {
      insert.run(p.id, p.projectId, p.name, p.position, at, at);
    },
    get(id) {
      const row = get.get(id) as Row | undefined;
      return row ? toPhase(row) : null;
    },
    listFor(projectId) {
      return (listFor.all(projectId) as Row[]).map(toPhase);
    },
  };
}

const toMilestone = (r: Row): Milestone => ({
  id: text(r, "id") as Id,
  projectId: text(r, "project_id") as Id,
  phaseId: maybe(r, "phase_id") as Id | null,
  name: text(r, "name"),
  dueOn: maybe(r, "due_on"),
  doneOn: maybe(r, "done_on"),
});

export function sqliteMilestoneStore(db: Database): MilestoneStore {
  const columns = "id, project_id, phase_id, name, due_on, done_on";
  const insert = db.prepare(`insert into milestone (${columns}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare("update milestone set phase_id = ?, name = ?, due_on = ?, done_on = ?, updated_at = ? where id = ?");
  const get = db.prepare(`select ${columns} from milestone where id = ?`);
  // Dated ones first, soonest first, then undated ones in the order they were added.
  const listFor = db.prepare(`select ${columns} from milestone where project_id = ? order by due_on is null, due_on, rowid`);
  const listOpen = db.prepare(
    `select ${columns.split(", ").map((c) => `m.${c}`).join(", ")}, p.name as project_name
       from milestone m join project p on p.id = m.project_id
      where m.done_on is null and p.status = 'active'
      order by m.due_on is null, m.due_on, m.rowid`,
  );
  return {
    insert(m, at) {
      insert.run(m.id, m.projectId, m.phaseId, m.name, m.dueOn, m.doneOn, at, at);
    },
    update(m, at) {
      update.run(m.phaseId, m.name, m.dueOn, m.doneOn, at, m.id);
    },
    get(id) {
      const row = get.get(id) as Row | undefined;
      return row ? toMilestone(row) : null;
    },
    listFor(projectId) {
      return (listFor.all(projectId) as Row[]).map(toMilestone);
    },
    listOpen() {
      return (listOpen.all() as Row[]).map((r) => ({ ...toMilestone(r), projectName: text(r, "project_name") }));
    },
  };
}

const toTask = (r: Row): Task => ({
  id: text(r, "id") as Id,
  projectId: text(r, "project_id") as Id,
  phaseId: maybe(r, "phase_id") as Id | null,
  title: text(r, "title"),
  description: text(r, "description"),
  assigneeId: maybe(r, "assignee_id") as Id | null,
  priority: text(r, "priority") as TaskPriority,
  dueOn: maybe(r, "due_on"),
  estimateMinutes: (r["estimate_minutes"] ?? null) as number | null,
  status: text(r, "status") as TaskStatus,
  doneAt: maybe(r, "done_at"),
});

export function sqliteTaskStore(db: Database): TaskStore {
  const columns = "id, project_id, phase_id, title, description, assignee_id, priority, due_on, estimate_minutes, status, done_at";
  const insert = db.prepare(`insert into task (${columns}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare(
    "update task set phase_id = ?, title = ?, description = ?, assignee_id = ?, priority = ?, due_on = ?, estimate_minutes = ?, status = ?, done_at = ?, updated_at = ? where id = ?",
  );
  const get = db.prepare(`select ${columns} from task where id = ?`);
  const joined = `select ${columns.split(", ").map((c) => `t.${c}`).join(", ")}, p.name as project_name, u.name as assignee_name
       from task t join project p on p.id = t.project_id left join user u on u.id = t.assignee_id`;
  const listFor = db.prepare(`${joined} where t.project_id = ? order by t.rowid`);
  const listBoard = db.prepare(`${joined} where p.status = 'active' and (t.status <> 'done' or t.done_at >= ?) order by t.rowid`);
  const row = (r: Row): TaskRow => ({ ...toTask(r), projectName: text(r, "project_name"), assigneeName: maybe(r, "assignee_name") });
  return {
    insert(t, at) {
      insert.run(t.id, t.projectId, t.phaseId, t.title, t.description, t.assigneeId, t.priority, t.dueOn, t.estimateMinutes, t.status, t.doneAt, at, at);
    },
    update(t, at) {
      update.run(t.phaseId, t.title, t.description, t.assigneeId, t.priority, t.dueOn, t.estimateMinutes, t.status, t.doneAt, at, t.id);
    },
    get(id) {
      const found = get.get(id) as Row | undefined;
      return found ? toTask(found) : null;
    },
    listFor(projectId) {
      return (listFor.all(projectId) as Row[]).map(row);
    },
    listBoard(doneSince) {
      return (listBoard.all(doneSince) as Row[]).map(row);
    },
  };
}

const toDeliverable = (r: Row): Deliverable => ({
  id: text(r, "id") as Id,
  projectId: text(r, "project_id") as Id,
  title: text(r, "title"),
  description: text(r, "description"),
  fileId: text(r, "file_id") as Id,
  status: text(r, "status") as DeliverableStatus,
  sharedAt: maybe(r, "shared_at"),
  decidedAt: maybe(r, "decided_at"),
  decisionNote: maybe(r, "decision_note"),
  createdBy: text(r, "created_by") as Id,
});

export function sqliteDeliverableStore(db: Database): DeliverableStore {
  const columns = "id, project_id, title, description, file_id, status, shared_at, decided_at, decision_note, created_by";
  const insert = db.prepare(`insert into deliverable (${columns}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare("update deliverable set title = ?, description = ?, status = ?, shared_at = ?, decided_at = ?, decision_note = ?, updated_at = ? where id = ?");
  const get = db.prepare(`select ${columns} from deliverable where id = ?`);
  const listFor = db.prepare(
    `select ${columns.split(", ").map((c) => `d.${c}`).join(", ")}, f.name as file_name, f.size_bytes as file_size
       from deliverable d join file f on f.id = d.file_id
      where d.project_id = ? order by d.rowid desc`,
  );
  return {
    insert(d, at) {
      insert.run(d.id, d.projectId, d.title, d.description, d.fileId, d.status, d.sharedAt, d.decidedAt, d.decisionNote, d.createdBy, at, at);
    },
    update(d, at) {
      update.run(d.title, d.description, d.status, d.sharedAt, d.decidedAt, d.decisionNote, at, d.id);
    },
    get(id) {
      const row = get.get(id) as Row | undefined;
      return row ? toDeliverable(row) : null;
    },
    listFor(projectId) {
      return (listFor.all(projectId) as Row[]).map((r): DeliverableRow => ({ ...toDeliverable(r), fileName: text(r, "file_name"), fileSize: r["file_size"] as number }));
    },
  };
}

/** A project's history, read from the audit table. A read model: it only ever selects. */
export function sqliteProjectHistory(db: Database): ProjectHistory {
  const select = db.prepare(
    `select e.id, e.occurred_at as occurredAt, e.action, u.name as actorName
       from activity_event e left join user u on u.id = e.actor_id
      where (e.record_type = 'project' and e.record_id = ?) or json_extract(e.context, '$.projectId') = ?
      order by e.rowid desc limit ?`,
  );
  return {
    forProject(projectId, limit) {
      return select.all(projectId, projectId, limit).map((row) => ({ ...row })) as HistoryRow[];
    },
  };
}
