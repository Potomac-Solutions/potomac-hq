import type { LinkKind, ProjectLink } from "../domain/link.ts";
import type { BaselineStore, DeliverableStore, ProjectLinkStore, MilestoneStore, PhaseStore, ProjectHistory, ProjectRow, ProjectStore, TaskRow, TaskStore, DeliverableRow, HistoryRow, LabelRow, LabelStore, WorkRow, WorkStore, TaskLinkStore, CommentStore, RepeatStore, CalendarFeed, CalendarFeedStore, ShareRow, ShareStore } from "../application/ports.ts";
import type { Baseline, BaselineLine } from "../domain/baseline.ts";
import type { Deliverable, DeliverableStatus } from "../domain/deliverable.ts";
import { byLabelName, labelKey, type Label, type LabelColour } from "../domain/label.ts";
import type { Comment } from "../domain/comment.ts";
import type { ShareLink, ShareRights } from "../domain/share.ts";
import type { Repeat, RepeatFrom, RepeatUnit } from "../domain/repeat.ts";
import type { SavedFilter } from "../domain/saved-filter.ts";
import type { Milestone, Phase } from "../domain/plan.ts";
import type { Project, ProjectHealth, ProjectKind, ProjectStatus } from "../domain/project.ts";
import type { Task, TaskPriority, TaskStatus } from "../domain/task.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Currency, Id } from "../../shared/index.ts";

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
    `select ${columns.split(", ").map((c) => `p.${c}`).join(", ")}, c.name as client_name, c.demo as client_demo, u.name as owner_name,
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
      return (list.all() as Row[]).map((r): ProjectRow => ({ ...toProject(r), clientName: text(r, "client_name"), ownerName: text(r, "owner_name"), openTasks: r["open_tasks"] as number, demo: r["client_demo"] === 1 }));
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
  forClient: r["for_client"] === 1,
});

export function sqliteMilestoneStore(db: Database): MilestoneStore {
  const columns = "id, project_id, phase_id, name, due_on, done_on, for_client";
  const insert = db.prepare(`insert into milestone (${columns}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare("update milestone set phase_id = ?, name = ?, due_on = ?, done_on = ?, for_client = ?, updated_at = ? where id = ?");
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
      insert.run(m.id, m.projectId, m.phaseId, m.name, m.dueOn, m.doneOn, m.forClient ? 1 : 0, at, at);
    },
    update(m, at) {
      update.run(m.phaseId, m.name, m.dueOn, m.doneOn, m.forClient ? 1 : 0, at, m.id);
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
  projectId: maybe(r, "project_id") as Id | null,
  phaseId: maybe(r, "phase_id") as Id | null,
  title: text(r, "title"),
  description: text(r, "description"),
  assigneeId: maybe(r, "assignee_id") as Id | null,
  priority: text(r, "priority") as TaskPriority,
  dueOn: maybe(r, "due_on"),
  startOn: maybe(r, "start_on"),
  estimateMinutes: (r["estimate_minutes"] ?? null) as number | null,
  status: text(r, "status") as TaskStatus,
  doneAt: maybe(r, "done_at"),
});

export function sqliteTaskStore(db: Database): TaskStore {
  const columns = "id, project_id, phase_id, title, description, assignee_id, priority, due_on, start_on, estimate_minutes, status, done_at";
  const insert = db.prepare(`insert into task (${columns}, organization_id, opportunity_id, created_by, parent_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare(
    "update task set phase_id = ?, title = ?, description = ?, assignee_id = ?, priority = ?, due_on = ?, start_on = ?, estimate_minutes = ?, status = ?, done_at = ?, updated_at = ? where id = ?",
  );
  const get = db.prepare(`select ${columns} from task where id = ?`);
  const joined = `select ${columns.split(", ").map((c) => `t.${c}`).join(", ")}, p.name as project_name, u.name as assignee_name
       from task t join project p on p.id = t.project_id left join user u on u.id = t.assignee_id`;
  const one = db.prepare(`select ${columns.split(", ").map((c) => `t.${c}`).join(", ")}, coalesce(p.name, '') as project_name, u.name as assignee_name
       from task t left join project p on p.id = t.project_id left join user u on u.id = t.assignee_id where t.id = ?`);
  const listFor = db.prepare(`${joined} where t.project_id = ? order by t.rowid`);
  const listBoard = db.prepare(`${joined} where p.status = 'active' and (t.status <> 'done' or t.done_at >= ?) order by t.rowid`);
  const row = (r: Row): TaskRow => ({ ...toTask(r), projectName: text(r, "project_name"), assigneeName: maybe(r, "assignee_name") });
  return {
    insert(t, at, origin = {}) {
      insert.run(t.id, t.projectId, t.phaseId, t.title, t.description, t.assigneeId, t.priority, t.dueOn, t.startOn, t.estimateMinutes, t.status, t.doneAt, origin.organizationId ?? null, origin.opportunityId ?? null, origin.createdBy ?? null, origin.parentId ?? null, at, at);
    },
    update(t, at) {
      update.run(t.phaseId, t.title, t.description, t.assigneeId, t.priority, t.dueOn, t.startOn, t.estimateMinutes, t.status, t.doneAt, at, t.id);
    },
    get(id) {
      const found = get.get(id) as Row | undefined;
      return found ? toTask(found) : null;
    },
    row(id) {
      const found = one.get(id) as Row | undefined;
      return found ? row(found) : null;
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
  const decider = db.prepare("update deliverable set decided_by_client = ? where id = ?");
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
    recordDecider(id, clientUserId) {
      decider.run(clientUserId, id);
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

export function sqliteBaselineStore(db: Database): BaselineStore {
  const set = db.prepare(
    `insert into project_baseline (project_id, proposal_id, version, pricing, amount_minor, currency, minutes, lines, set_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (project_id) do update set proposal_id = excluded.proposal_id, version = excluded.version, pricing = excluded.pricing,
       amount_minor = excluded.amount_minor, currency = excluded.currency, minutes = excluded.minutes, lines = excluded.lines, set_at = excluded.set_at`,
  );
  const get = db.prepare("select project_id, proposal_id, version, pricing, amount_minor, currency, minutes, lines from project_baseline where project_id = ?");
  return {
    set(b, at) {
      set.run(b.projectId, b.proposalId, b.version, b.pricing, b.amount.minor, b.amount.currency, b.minutes, JSON.stringify(b.lines), at);
    },
    get(projectId) {
      const r = get.get(projectId) as Row | undefined;
      if (!r) return null;
      return {
        projectId: text(r, "project_id") as Id,
        proposalId: text(r, "proposal_id") as Id,
        version: r["version"] as number,
        pricing: text(r, "pricing"),
        amount: { minor: r["amount_minor"] as number, currency: text(r, "currency") as Currency },
        minutes: r["minutes"] as number,
        lines: JSON.parse(text(r, "lines")) as BaselineLine[],
      } satisfies Baseline;
    },
  };
}

export function sqliteProjectLinkStore(db: Database): ProjectLinkStore {
  const columns = "id, project_id, kind, label, url, shared, created_by";
  const insert = db.prepare(`insert into project_link (${columns}, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)`);
  const get = db.prepare(`select ${columns} from project_link where id = ?`);
  const remove = db.prepare("delete from project_link where id = ?");
  const listFor = db.prepare(`select ${columns} from project_link where project_id = ? order by created_at, rowid`);
  const toLink = (row: Record<string, unknown>): ProjectLink => ({
    id: row["id"] as Id,
    projectId: row["project_id"] as Id,
    kind: row["kind"] as LinkKind,
    label: String(row["label"]),
    url: String(row["url"]),
    shared: row["shared"] === 1,
    createdBy: row["created_by"] as Id,
  });
  return {
    insert(l, at) {
      insert.run(l.id, l.projectId, l.kind, l.label, l.url, l.shared ? 1 : 0, l.createdBy, at);
    },
    get(id) {
      const row = get.get(id);
      return row ? toLink(row) : null;
    },
    remove(id) {
      remove.run(id);
    },
    listFor: (projectId) => listFor.all(projectId).map(toLink),
  };
}

export function sqliteLabelStore(db: Database): LabelStore {
  const insert = db.prepare("insert into label (id, name, name_key, colour, created_at, updated_at) values (?, ?, ?, ?, ?, ?)");
  const update = db.prepare("update label set name = ?, name_key = ?, colour = ?, updated_at = ? where id = ?");
  const untag = db.prepare("delete from task_label where label_id = ?");
  const remove = db.prepare("delete from label where id = ?");
  const get = db.prepare("select id, name, colour from label where id = ?");
  const byName = db.prepare("select id, name, colour from label where name_key = ?");
  const list = db.prepare("select l.id, l.name, l.colour, (select count(*) from task_label tl where tl.label_id = l.id) as tasks from label l");
  const forTask = db.prepare("select l.id, l.name, l.colour from task_label tl join label l on l.id = tl.label_id where tl.task_id = ?");
  const clear = db.prepare("delete from task_label where task_id = ?");
  const tag = db.prepare("insert or ignore into task_label (task_id, label_id) values (?, ?)");
  const toLabel = (r: Row): Label => ({ id: text(r, "id") as Id, name: text(r, "name"), colour: text(r, "colour") as LabelColour });
  return {
    insert(l, at) {
      insert.run(l.id, l.name, labelKey(l.name), l.colour, at, at);
    },
    update(l, at) {
      update.run(l.name, labelKey(l.name), l.colour, at, l.id);
    },
    remove(id) {
      untag.run(id);
      remove.run(id);
    },
    get(id) {
      const found = get.get(id) as Row | undefined;
      return found ? toLabel(found) : null;
    },
    byName(name) {
      const found = byName.get(labelKey(name)) as Row | undefined;
      return found ? toLabel(found) : null;
    },
    list() {
      return (list.all() as Row[]).map((r): LabelRow => ({ ...toLabel(r), tasks: r["tasks"] as number })).sort(byLabelName);
    },
    forTask(taskId) {
      return (forTask.all(taskId) as Row[]).map(toLabel).sort(byLabelName);
    },
    forTasks(taskIds) {
      const found = new Map<Id, Label[]>();
      // In chunks, so a long board never passes SQLite's limit on bound values.
      for (let at = 0; at < taskIds.length; at += 500) {
        const chunk = taskIds.slice(at, at + 500);
        const rows = db
          .prepare(`select tl.task_id, l.id, l.name, l.colour from task_label tl join label l on l.id = tl.label_id where tl.task_id in (${chunk.map(() => "?").join(", ")})`)
          .all(...chunk) as Row[];
        for (const r of rows) {
          const taskId = text(r, "task_id") as Id;
          found.set(taskId, [...(found.get(taskId) ?? []), toLabel(r)]);
        }
      }
      for (const labels of found.values()) labels.sort(byLabelName);
      return found;
    },
    setForTask(taskId, labelIds) {
      clear.run(taskId);
      for (const labelId of new Set(labelIds)) tag.run(taskId, labelId);
    },
  };
}

export function sqliteShareStore(db: Database): ShareStore {
  const cols = "s.id, s.project_id, s.label, s.rights, s.expires_on, s.created_by, s.created_at, s.stopped_at, s.visits, s.last_visited_at";
  const insert = db.prepare("insert into project_share (id, project_id, token_hash, label, rights, expires_on, created_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)");
  const get = db.prepare(`select ${cols} from project_share s where s.id = ?`);
  const byHash = db.prepare(`select ${cols} from project_share s where s.token_hash = ?`);
  const forProject = db.prepare(`select ${cols}, coalesce(u.name, '') as created_by_name from project_share s left join user u on u.id = s.created_by where s.project_id = ? order by s.created_at desc, s.rowid desc`);
  const stop = db.prepare("update project_share set stopped_at = ?, stopped_by = ? where id = ? and stopped_at is null");
  const visited = db.prepare("update project_share set visits = visits + 1, last_visited_at = ? where id = ?");
  const toLink = (r: Row): ShareLink => ({ id: text(r, "id") as Id, projectId: text(r, "project_id") as Id, label: text(r, "label"), rights: text(r, "rights") as ShareRights, expiresOn: maybe(r, "expires_on"), createdBy: text(r, "created_by") as Id, createdAt: text(r, "created_at"), stoppedAt: maybe(r, "stopped_at") });
  const one = (r: Row | undefined) => (r ? toLink(r) : null);
  return {
    insert: (l, tokenHash) => void insert.run(l.id, l.projectId, tokenHash, l.label, l.rights, l.expiresOn, l.createdBy, l.createdAt),
    get: (id) => one(get.get(id) as Row | undefined),
    byHash: (tokenHash) => one(byHash.get(tokenHash) as Row | undefined),
    forProject: (projectId) => (forProject.all(projectId) as Row[]).map((r): ShareRow => ({ ...toLink(r), createdByName: text(r, "created_by_name"), visits: Number(r["visits"]), lastVisitedAt: maybe(r, "last_visited_at") })),
    stop: (id, by, at) => void stop.run(at, by, id),
    visited: (id, at) => void visited.run(at, id),
  };
}

export function sqliteCalendarFeedStore(db: Database): CalendarFeedStore {
  const cols = "user_id, token_hash, filter_id, created_at, last_used_at";
  const forUser = db.prepare(`select ${cols} from calendar_feed where user_id = ?`);
  const byHash = db.prepare(`select ${cols} from calendar_feed where token_hash = ?`);
  const save = db.prepare(`insert into calendar_feed (${cols}) values (?, ?, ?, ?, ?) on conflict (user_id) do update set token_hash = excluded.token_hash, filter_id = excluded.filter_id, created_at = excluded.created_at, last_used_at = excluded.last_used_at`);
  const remove = db.prepare("delete from calendar_feed where user_id = ?");
  const used = db.prepare("update calendar_feed set last_used_at = ? where user_id = ?");
  const toFeed = (r: Row): CalendarFeed => ({ userId: text(r, "user_id") as Id, tokenHash: text(r, "token_hash"), filterId: maybe(r, "filter_id") as Id | null, createdAt: text(r, "created_at"), lastUsedAt: maybe(r, "last_used_at") });
  return {
    forUser(userId) {
      const found = forUser.get(userId) as Row | undefined;
      return found ? toFeed(found) : null;
    },
    byHash(tokenHash) {
      const found = byHash.get(tokenHash) as Row | undefined;
      return found ? toFeed(found) : null;
    },
    save: (f) => void save.run(f.userId, f.tokenHash, f.filterId, f.createdAt, f.lastUsedAt),
    remove: (userId) => void remove.run(userId),
    used: (userId, at) => void used.run(at, userId),
  };
}

export function sqliteRepeatStore(db: Database): RepeatStore {
  const get = db.prepare("select id, repeat_every, repeat_unit, repeat_from from task where id = ? and repeat_every is not null");
  const set = db.prepare("update task set repeat_every = ?, repeat_unit = ?, repeat_from = ?, updated_at = ? where id = ?");
  const many = db.prepare("select id, repeat_every, repeat_unit, repeat_from from task where repeat_every is not null and id in (select value from json_each(?))");
  const setPrevious = db.prepare("update task set previous_id = ? where id = ?");
  const previousOf = db.prepare("select previous_id from task where id = ?");
  const nextOf = db.prepare("select id from task where previous_id = ?");
  const place = db.prepare("select organization_id, opportunity_id from task where id = ?");
  const toRepeat = (r: Row): Repeat => ({ every: Number(r["repeat_every"]), unit: text(r, "repeat_unit") as RepeatUnit, from: text(r, "repeat_from") as RepeatFrom });
  return {
    get(taskId) {
      const found = get.get(taskId) as Row | undefined;
      return found ? toRepeat(found) : null;
    },
    set: (taskId, repeat, at) => void set.run(repeat?.every ?? null, repeat?.unit ?? null, repeat?.from ?? null, at, taskId),
    forTasks(taskIds) {
      const found = new Map<Id, Repeat>();
      if (taskIds.length === 0) return found;
      for (const r of many.all(JSON.stringify(taskIds)) as Row[]) found.set(text(r, "id") as Id, toRepeat(r));
      return found;
    },
    setPrevious: (taskId, previousId) => void setPrevious.run(previousId, taskId),
    previousOf: (taskId) => ((previousOf.get(taskId) as Row | undefined)?.["previous_id"] ?? null) as Id | null,
    nextOf: (taskId) => ((nextOf.get(taskId) as Row | undefined)?.["id"] ?? null) as Id | null,
    todoPlace(taskId) {
      const found = place.get(taskId) as Row | undefined;
      return { organizationId: (found?.["organization_id"] ?? null) as Id | null, opportunityId: (found?.["opportunity_id"] ?? null) as Id | null };
    },
  };
}

export function sqliteCommentStore(db: Database): CommentStore {
  const insert = db.prepare("insert into task_comment (id, task_id, author_id, share_id, guest_name, body, created_at, edited_at) values (?, ?, ?, ?, ?, ?, ?, ?)");
  const update = db.prepare("update task_comment set body = ?, edited_at = ? where id = ?");
  const remove = db.prepare("delete from task_comment where id = ?");
  const get = db.prepare("select id, task_id, author_id, share_id, guest_name, body, created_at, edited_at from task_comment where id = ?");
  const forTask = db.prepare("select c.id, c.task_id, c.author_id, c.share_id, c.guest_name, c.body, c.created_at, c.edited_at, coalesce(u.name, c.guest_name, '') as author_name, coalesce(s.label, '') as share_label from task_comment c left join user u on u.id = c.author_id left join project_share s on s.id = c.share_id where c.task_id = ? order by c.created_at, c.rowid");
  const fromLinks = db.prepare("select c.id, c.task_id, c.author_id, c.share_id, c.guest_name, c.body, c.created_at, c.edited_at, c.guest_name as author_name, coalesce(s.label, '') as share_label from task_comment c join project_share s on s.id = c.share_id where s.project_id = ? order by c.created_at, c.rowid");
  const organizationOf = db.prepare("select coalesce(p.organization_id, t.organization_id) as organization_id from task t left join project p on p.id = t.project_id where t.id = ?");
  const toComment = (r: Row): Comment => ({ id: text(r, "id") as Id, taskId: text(r, "task_id") as Id, authorId: maybe(r, "author_id") as Id | null, shareId: maybe(r, "share_id") as Id | null, guestName: maybe(r, "guest_name"), body: text(r, "body"), createdAt: text(r, "created_at"), editedAt: maybe(r, "edited_at") });
  const withNames = (r: Row) => ({ ...toComment(r), authorName: text(r, "author_name"), shareLabel: text(r, "share_label") });
  return {
    insert: (c) => void insert.run(c.id, c.taskId, c.authorId, c.shareId, c.guestName, c.body, c.createdAt, c.editedAt),
    update: (c) => void update.run(c.body, c.editedAt, c.id),
    remove: (id) => void remove.run(id),
    get(id) {
      const found = get.get(id) as Row | undefined;
      return found ? toComment(found) : null;
    },
    forTask: (taskId) => (forTask.all(taskId) as Row[]).map(withNames),
    fromLinks: (projectId) => (fromLinks.all(projectId) as Row[]).map(withNames),
    organizationOf: (taskId) => ((organizationOf.get(taskId) as Row | undefined)?.["organization_id"] ?? null) as Id | null,
  };
}

export function sqliteTaskLinkStore(db: Database): TaskLinkStore {
  const columns = "t.id, t.project_id, t.phase_id, t.title, t.description, t.assignee_id, t.priority, t.due_on, t.start_on, t.estimate_minutes, t.status, t.done_at, coalesce(p.name, '') as project_name, u.name as assignee_name";
  const from = "from task t left join project p on p.id = t.project_id left join user u on u.id = t.assignee_id";
  const parentOf = db.prepare("select parent_id from task where id = ?");
  const subtasks = db.prepare(`select ${columns} ${from} where t.parent_id = ? order by t.rowid`);
  const block = db.prepare("insert into task_block (blocked_id, blocker_id, created_by, created_at) values (?, ?, ?, ?)");
  const unblock = db.prepare("delete from task_block where blocked_id = ? and blocker_id = ?");
  const blockersOf = db.prepare("select blocker_id from task_block where blocked_id = ?");
  const waitingOn = db.prepare(`select ${columns} ${from} join task_block b on b.blocker_id = t.id where b.blocked_id = ? order by t.status = 'done', t.title collate nocase`);
  const holdingUp = db.prepare(`select ${columns} ${from} join task_block b on b.blocked_id = t.id where b.blocker_id = ? order by t.status = 'done', t.title collate nocase`);
  const row = (r: Row): TaskRow => ({ ...toTask(r), projectName: text(r, "project_name"), assigneeName: maybe(r, "assignee_name") });
  // Counts for many tasks at once, without a query per task: the ids go in as one JSON array.
  const progress = db.prepare("select parent_id, count(*) as total, sum(status = 'done') as done from task where parent_id in (select value from json_each(?)) group by parent_id");
  const open = db.prepare("select b.blocked_id, count(*) as open from task_block b join task t on t.id = b.blocker_id where t.status <> 'done' and b.blocked_id in (select value from json_each(?)) group by b.blocked_id");
  return {
    parentOf: (taskId) => ((parentOf.get(taskId) as Row | undefined)?.["parent_id"] ?? null) as Id | null,
    subtasks: (parentId) => (subtasks.all(parentId) as Row[]).map(row),
    progress(parentIds) {
      const found = new Map<Id, { done: number; total: number }>();
      if (parentIds.length === 0) return found;
      for (const r of progress.all(JSON.stringify(parentIds)) as Row[]) found.set(text(r, "parent_id") as Id, { done: Number(r["done"] ?? 0), total: Number(r["total"]) });
      return found;
    },
    block: (blockedId, blockerId, by, at) => void block.run(blockedId, blockerId, by, at),
    unblock: (blockedId, blockerId) => Number(unblock.run(blockedId, blockerId).changes) > 0,
    blockersOf: (taskId) => (blockersOf.all(taskId) as Row[]).map((r) => text(r, "blocker_id") as Id),
    waitingOn: (taskId) => (waitingOn.all(taskId) as Row[]).map(row),
    holdingUp: (taskId) => (holdingUp.all(taskId) as Row[]).map(row),
    openBlockers(taskIds) {
      const found = new Map<Id, number>();
      if (taskIds.length === 0) return found;
      for (const r of open.all(JSON.stringify(taskIds)) as Row[]) found.set(text(r, "blocked_id") as Id, Number(r["open"]));
      return found;
    },
  };
}

export function sqliteWorkStore(db: Database): WorkStore {
  const rows = db.prepare(`select t.id, t.project_id, t.phase_id, t.title, t.description, t.assignee_id, t.priority, t.due_on, t.start_on, t.estimate_minutes, t.status, t.done_at,
      coalesce(p.name, '') as project_name, coalesce(p.organization_id, t.organization_id) as organization_id, coalesce(c.name, '') as client_name, coalesce(u.name, '') as assignee_name
    from task t
    left join project p on p.id = t.project_id
    left join client_organization c on c.id = coalesce(p.organization_id, t.organization_id)
    left join user u on u.id = t.assignee_id
    where t.project_id is null or p.status = 'active'
    order by t.rowid`);
  const insertFilter = db.prepare("insert into saved_filter (id, owner_id, name, query, shared, pinned, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)");
  const updateFilter = db.prepare("update saved_filter set name = ?, query = ?, shared = ?, pinned = ?, updated_at = ? where id = ?");
  const removeFilter = db.prepare("delete from saved_filter where id = ?");
  const clients = db.prepare("select id, name from client_organization where status <> 'former' order by name collate nocase");
  const getFilter = db.prepare("select id, owner_id, name, query, shared, pinned from saved_filter where id = ?");
  const filtersFor = db.prepare("select id, owner_id, name, query, shared, pinned from saved_filter where owner_id = ? or shared = 1 order by name collate nocase, created_at");
  const columns = db.prepare("select columns from work_view where user_id = ?");
  const setColumns = db.prepare("insert into work_view (user_id, columns, updated_at) values (?, ?, ?) on conflict (user_id) do update set columns = excluded.columns, updated_at = excluded.updated_at");
  const toFilter = (r: Row): SavedFilter => ({ id: text(r, "id") as Id, ownerId: text(r, "owner_id") as Id, name: text(r, "name"), query: text(r, "query"), shared: r["shared"] === 1, pinned: r["pinned"] === 1 });
  return {
    clients() {
      return (clients.all() as Row[]).map((r) => ({ id: text(r, "id") as Id, name: text(r, "name") }));
    },
    rows() {
      return (rows.all() as Row[]).map((r): WorkRow => ({
        ...toTask(r),
        projectName: text(r, "project_name"),
        organizationId: maybe(r, "organization_id") as Id | null,
        clientName: text(r, "client_name"),
        assigneeName: text(r, "assignee_name"),
      }));
    },
    insertFilter(f, at) {
      insertFilter.run(f.id, f.ownerId, f.name, f.query, f.shared ? 1 : 0, f.pinned ? 1 : 0, at, at);
    },
    updateFilter(f, at) {
      updateFilter.run(f.name, f.query, f.shared ? 1 : 0, f.pinned ? 1 : 0, at, f.id);
    },
    removeFilter(id) {
      removeFilter.run(id);
    },
    getFilter(id) {
      const found = getFilter.get(id) as Row | undefined;
      return found ? toFilter(found) : null;
    },
    filtersFor(personId) {
      return (filtersFor.all(personId) as Row[]).map(toFilter);
    },
    columns(personId) {
      return ((columns.get(personId) as Row | undefined)?.["columns"] as string | undefined) ?? "";
    },
    setColumns(personId, chosen, at) {
      setColumns.run(personId, chosen, at);
    },
  };
}
