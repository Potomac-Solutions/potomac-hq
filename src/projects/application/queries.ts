// What the projects module's pages show. Each read checks permission.
// Reading changes nothing, so it writes no activity event.
import { LINK_KIND_LABELS, LINK_KINDS, linkName } from "../domain/link.ts";
import { DELIVERABLE_STATUS_LABELS, HEALTH_LABELS, KIND_LABELS, options, PRIORITY_LABELS, STATUS_LABELS, TASK_STATUS_LABELS } from "../domain/labels.ts";
import { isMilestoneOverdue, milestoneProgress, nextMilestone, type Milestone } from "../domain/plan.ts";
import { PROJECT_STATUSES } from "../domain/project.ts";
import { byUrgency, formatHours, isTaskOverdue, TASK_STATUSES } from "../domain/task.ts";
import { LABEL_COLOUR_NAMES, LABEL_COLOURS, type Label } from "../domain/label.ts";
import { formatSize } from "../../files/index.ts";
import { authorize } from "../../identity/index.ts";
import { describeEvent, dueText, err, formatMoney, friendlyDay, ok, type Id, type Result } from "../../shared/index.ts";
import type { ProjectsDeps, Refused } from "./commands.ts";
import type { TaskRow } from "./ports.ts";

export type Option = { readonly value: string; readonly label: string };

const may = (deps: ProjectsDeps, actorId: Id | null, action: string): boolean => actorId !== null && authorize(deps, actorId, action).ok;

type MilestoneView = { readonly id: string; readonly name: string; readonly dueOn: string; readonly dueText: string; readonly doneText: string; readonly doneOn: string; readonly done: boolean; readonly overdue: boolean; readonly phaseName: string; readonly forClient: boolean };

function milestoneView(milestone: Milestone, today: string, phaseName = ""): MilestoneView {
  return { id: milestone.id, name: milestone.name, dueOn: milestone.dueOn ?? "", dueText: milestone.dueOn ? dueText(milestone.dueOn, today) : "", doneText: milestone.doneOn ? friendlyDay(milestone.doneOn, today) : "", doneOn: milestone.doneOn ?? "", done: milestone.doneOn !== null, overdue: isMilestoneOverdue(milestone, today), phaseName, forClient: milestone.forClient };
}

export type ProjectListView = {
  /** The status the list is filtered by, or "" for every project. */
  readonly status: string;
  readonly statuses: readonly Option[];
  readonly projects: readonly {
    readonly id: string;
    readonly name: string;
    readonly clientName: string;
    readonly ownerName: string;
    readonly status: string;
    readonly statusLabel: string;
    readonly health: string;
    readonly healthLabel: string;
    readonly targetOn: string;
    readonly openTasks: number;
    /** Its client is a demo. */
    readonly demo: boolean;
    /** "Design signed off, due 2026-12-05", or "" when there is none. */
    readonly next: string;
    readonly nextOverdue: boolean;
  }[];
};

/** Every project, or only those with one status. An unknown status shows every project. */
export function listProjects(deps: ProjectsDeps, actorId: Id | null, filter: { readonly status?: string; readonly withoutDemos?: boolean } = {}): Result<ProjectListView, "forbidden"> {
  if (!may(deps, actorId, "project.view")) return err("forbidden");
  const status = filter.status && (PROJECT_STATUSES as readonly string[]).includes(filter.status) ? filter.status : "";
  const today = deps.today();
  const open = deps.milestones.listOpen();
  return ok({
    status,
    statuses: options(STATUS_LABELS),
    projects: deps.projects
      .list()
      .filter((project) => (status === "" || project.status === status) && !(filter.withoutDemos && project.demo))
      .map((project) => {
        const next = nextMilestone(open.filter((milestone) => milestone.projectId === project.id));
        return {
          id: project.id,
          name: project.name,
          clientName: project.clientName,
          demo: project.demo,
          ownerName: project.ownerName,
          status: project.status,
          statusLabel: STATUS_LABELS[project.status] ?? project.status,
          health: project.health,
          healthLabel: HEALTH_LABELS[project.health] ?? project.health,
          targetOn: project.targetOn ?? "",
          openTasks: project.openTasks,
          next: next ? (next.dueOn ? `${next.name}, due ${dueText(next.dueOn, today)}` : next.name) : "",
          nextOverdue: next ? isMilestoneOverdue(next, today) : false,
        };
      }),
  });
}

export type ProjectView = {
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly kindLabel: string;
    readonly status: string;
    readonly statusLabel: string;
    readonly health: string;
    readonly healthLabel: string;
    readonly startOn: string;
    readonly targetOn: string;
    readonly ownerId: string;
    readonly ownerName: string;
    readonly active: boolean;
    readonly ongoing: boolean;
    readonly demo: boolean;
  };
  readonly clientId: string;
  readonly clientName: string;
  readonly opportunityId: string;
  readonly next: MilestoneView | null;
  readonly progress: { readonly done: number; readonly total: number };
  readonly phases: readonly { readonly id: string; readonly name: string }[];
  readonly milestones: readonly MilestoneView[];
  readonly taskCounts: readonly { readonly status: string; readonly label: string; readonly count: number }[];
  readonly deliverables: readonly {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly fileId: string;
    readonly fileName: string;
    readonly fileSize: string;
    readonly status: string;
    readonly statusLabel: string;
    readonly decisionNote: string;
    readonly canShare: boolean;
    readonly canUnshare: boolean;
  }[];
  readonly history: readonly { readonly id: string; readonly text: string; readonly when: string; readonly whenIso: string }[];
  /** What was agreed, from the accepted proposal. Null when there is none, or the viewer may not see prices. */
  readonly baseline: {
    readonly proposalId: string;
    readonly version: number;
    readonly amount: string;
    readonly hours: string;
    readonly lines: readonly { readonly key: string; readonly item: string; readonly quantity: string; readonly total: string }[];
  } | null;
  readonly can: {
    readonly edit: boolean;
    readonly setStatus: boolean;
    readonly setOwner: boolean;
    readonly plan: boolean;
    readonly viewTasks: boolean;
    readonly editDeliverables: boolean;
    readonly download: boolean;
  };
  readonly healths: readonly Option[];
  readonly people: readonly Option[];
};

const people = (deps: ProjectsDeps): Option[] =>
  deps.users
    .list()
    .filter((user) => user.status === "active")
    .map((user) => ({ value: user.id, label: user.name }));

export function projectOverview(deps: ProjectsDeps, actorId: Id | null, projectId: Id): Result<ProjectView, Refused> {
  if (!may(deps, actorId, "project.view")) return err("forbidden");
  const project = deps.projects.list().find((row) => row.id === projectId);
  if (!project) return err("not-found");
  const today = deps.today();
  const phases = deps.phases.listFor(projectId);
  const phaseName = (id: Id | null) => phases.find((phase) => phase.id === id)?.name ?? "";
  const milestones = deps.milestones.listFor(projectId);
  const next = nextMilestone(milestones);
  const viewTasks = may(deps, actorId, "task.view");
  const tasks = viewTasks ? deps.tasks.listFor(projectId) : [];
  const active = project.status === "active";
  const editDeliverables = may(deps, actorId, "deliverable.edit");
  const agreed = may(deps, actorId, "opportunity.view-value") ? deps.baselines.get(projectId) : null;
  return ok({
    baseline: agreed
      ? {
          proposalId: agreed.proposalId,
          version: agreed.version,
          amount: agreed.pricing === "free" ? "Free" : `${formatMoney(agreed.amount)}${agreed.pricing === "monthly" ? " a month" : agreed.pricing === "yearly" ? " a year" : ""}`,
          hours: agreed.minutes > 0 ? formatHours(agreed.minutes) : "",
          lines: agreed.lines.map((line, index) => ({
            key: String(index),
            item: line.item,
            quantity: line.kind === "hours" ? `${formatHours(Math.round((line.quantity * 60) / 100))} h` : String(line.quantity / 100),
            total: formatMoney(line.total),
          })),
        }
      : null,
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      kindLabel: KIND_LABELS[project.kind] ?? project.kind,
      status: project.status,
      statusLabel: STATUS_LABELS[project.status] ?? project.status,
      health: project.health,
      healthLabel: HEALTH_LABELS[project.health] ?? project.health,
      startOn: project.startOn ?? "",
      targetOn: project.targetOn ?? "",
      ownerId: project.ownerId,
      ownerName: project.ownerName,
      active,
      ongoing: project.kind === "ongoing",
      demo: project.demo,
    },
    clientId: project.organizationId,
    clientName: project.clientName,
    opportunityId: project.opportunityId,
    next: next ? milestoneView(next, today, phaseName(next.phaseId)) : null,
    progress: milestoneProgress(milestones),
    phases: phases.map((phase) => ({ id: phase.id, name: phase.name })),
    milestones: milestones.map((milestone) => milestoneView(milestone, today, phaseName(milestone.phaseId))),
    taskCounts: TASK_STATUSES.map((status) => ({ status, label: TASK_STATUS_LABELS[status] ?? status, count: tasks.filter((task) => task.status === status).length })),
    deliverables: deps.deliverables.listFor(projectId).map((deliverable) => ({
      id: deliverable.id,
      title: deliverable.title,
      description: deliverable.description,
      fileId: deliverable.fileId,
      fileName: deliverable.fileName,
      fileSize: formatSize(deliverable.fileSize),
      status: deliverable.status,
      statusLabel: DELIVERABLE_STATUS_LABELS[deliverable.status] ?? deliverable.status,
      decisionNote: deliverable.decisionNote ?? "",
      canShare: editDeliverables && (deliverable.status === "draft" || deliverable.status === "changes-requested"),
      canUnshare: editDeliverables && (deliverable.status === "shared" || deliverable.status === "changes-requested"),
    })),
    history: deps.history.forProject(projectId, 30).map((row) => ({ id: row.id, text: describeEvent(row.action, row.actorName), when: deps.formatWhen(row.occurredAt), whenIso: row.occurredAt })),
    can: {
      edit: may(deps, actorId, "project.edit"),
      setStatus: may(deps, actorId, "project.set-status") && active,
      setOwner: may(deps, actorId, "project.set-owner"),
      plan: may(deps, actorId, "project.plan") && active,
      viewTasks,
      editDeliverables: editDeliverables && active,
      download: may(deps, actorId, "file.download"),
    },
    healths: options(HEALTH_LABELS),
    people: people(deps),
  });
}

export type TaskCard = {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly assigneeName: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly priority: string;
  readonly priorityLabel: string;
  /** True for high and urgent, which the screens mark. */
  readonly pressing: boolean;
  readonly dueOn: string;
  /** "Sat, Nov 21, in 5 days". */
  readonly dueText: string;
  readonly overdue: boolean;
  readonly estimate: string;
  /** By name. */
  readonly labels: readonly LabelChip[];
};

/** A label as the screens draw it: its name, in its colour. */
export type LabelChip = { readonly id: string; readonly name: string; readonly colour: string };

const chip = (label: Label): LabelChip => ({ id: label.id, name: label.name, colour: label.colour });

/** Cards for many tasks, with their labels read in one go. */
function cards(deps: ProjectsDeps, tasks: readonly TaskRow[], today: string): TaskCard[] {
  const labels = deps.labels.forTasks(tasks.map((task) => task.id));
  return tasks.map((task) => card(task, today, labels.get(task.id) ?? []));
}

function card(task: TaskRow, today: string, labels: readonly Label[] = []): TaskCard {
  return {
    labels: labels.map(chip),
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    projectName: task.projectName,
    assigneeName: task.assigneeName ?? "",
    status: task.status,
    statusLabel: TASK_STATUS_LABELS[task.status] ?? task.status,
    priority: task.priority,
    priorityLabel: PRIORITY_LABELS[task.priority] ?? task.priority,
    pressing: task.priority === "high" || task.priority === "urgent",
    dueOn: task.dueOn ?? "",
    dueText: task.dueOn ? dueText(task.dueOn, today) : "",
    overdue: isTaskOverdue(task, today),
    estimate: task.estimateMinutes === null ? "" : formatHours(task.estimateMinutes),
  };
}

export type TaskFormOptions = { readonly people: readonly Option[]; readonly phases: readonly Option[]; readonly priorities: readonly Option[]; readonly statuses: readonly Option[] };

function formOptions(deps: ProjectsDeps, projectId: Id): TaskFormOptions {
  return {
    people: people(deps),
    phases: deps.phases.listFor(projectId).map((phase) => ({ value: phase.id, label: phase.name })),
    priorities: options(PRIORITY_LABELS),
    statuses: options(TASK_STATUS_LABELS),
  };
}

export type ProjectTasksView = {
  readonly project: { readonly id: string; readonly name: string; readonly active: boolean };
  readonly tasks: readonly TaskCard[];
  readonly canEdit: boolean;
  readonly canAdd: boolean;
  readonly form: TaskFormOptions;
};

/** A project's tasks as a list: open ones by urgency, then finished ones. */
export function projectTasks(deps: ProjectsDeps, actorId: Id | null, projectId: Id): Result<ProjectTasksView, Refused> {
  if (!may(deps, actorId, "project.view") || !may(deps, actorId, "task.view")) return err("forbidden");
  const project = deps.projects.get(projectId);
  if (!project) return err("not-found");
  const today = deps.today();
  const all = deps.tasks.listFor(projectId);
  const open = all.filter((task) => task.status !== "done").sort(byUrgency);
  const done = all.filter((task) => task.status === "done").sort((a, b) => ((a.doneAt ?? "") < (b.doneAt ?? "") ? 1 : -1));
  const canEdit = may(deps, actorId, "task.edit");
  return ok({
    project: { id: project.id, name: project.name, active: project.status === "active" },
    tasks: cards(deps, [...open, ...done], today),
    canEdit,
    canAdd: canEdit && project.status === "active",
    form: formOptions(deps, projectId),
  });
}

export type TaskDetailView = {
  readonly task: TaskCard & { readonly description: string; readonly assigneeId: string; readonly phaseId: string; readonly doneWhen: string };
  readonly canEdit: boolean;
  readonly form: TaskFormOptions;
  /** Every label, each marked if the task has it, for the picker. */
  readonly labelChoices: readonly (LabelChip & { readonly on: boolean })[];
  readonly colours: readonly Option[];
};

export function taskDetail(deps: ProjectsDeps, actorId: Id | null, taskId: Id): Result<TaskDetailView, Refused> {
  if (!may(deps, actorId, "task.view")) return err("forbidden");
  const found = deps.tasks.get(taskId);
  const task = found ? deps.tasks.listFor(found.projectId).find((row) => row.id === taskId) : undefined;
  if (!task) return err("not-found");
  const onTask = new Set<string>(deps.labels.forTask(taskId).map((label) => label.id));
  return ok({
    task: { ...card(task, deps.today(), deps.labels.forTask(taskId)), description: task.description, assigneeId: task.assigneeId ?? "", phaseId: task.phaseId ?? "", doneWhen: task.doneAt ? deps.formatWhen(task.doneAt) : "" },
    canEdit: may(deps, actorId, "task.edit"),
    form: formOptions(deps, task.projectId),
    labelChoices: deps.labels.list().map((label) => ({ ...chip(label), on: onTask.has(label.id) })),
    colours: colourOptions(),
  });
}

const colourOptions = (): Option[] => LABEL_COLOURS.map((colour) => ({ value: colour, label: LABEL_COLOUR_NAMES[colour] }));

export type LabelsView = {
  readonly labels: readonly (LabelChip & { readonly colourName: string; readonly tasks: number })[];
  readonly colours: readonly Option[];
  /** May make a label. */
  readonly canAdd: boolean;
  /** May rename, recolour and delete. */
  readonly canManage: boolean;
};

/** Every label, with how many tasks have it. */
export function labelsPage(deps: ProjectsDeps, actorId: Id | null): Result<LabelsView, "forbidden"> {
  if (!may(deps, actorId, "task.view")) return err("forbidden");
  return ok({
    labels: deps.labels.list().map((label) => ({ ...chip(label), colourName: LABEL_COLOUR_NAMES[label.colour], tasks: label.tasks })),
    colours: colourOptions(),
    canAdd: may(deps, actorId, "task.edit"),
    canManage: may(deps, actorId, "label.manage"),
  });
}

export type BoardView = {
  /** The project the board is for, or null for every active project. */
  readonly project: { readonly id: string; readonly name: string } | null;
  readonly mine: boolean;
  readonly columns: readonly { readonly status: string; readonly label: string; readonly cards: readonly TaskCard[] }[];
  readonly total: number;
  readonly canMove: boolean;
  readonly statuses: readonly Option[];
  /** Where a move sends the browser back to. */
  readonly returnTo: string;
};

/** How long a finished task stays on the board. */
const DONE_DAYS = 14;

/**
 * Tasks by status, for one project or for every active one. Finished tasks
 * stay in the last column for two weeks. `mine` keeps only the viewer's own.
 */
export function board(deps: ProjectsDeps, actorId: Id | null, filter: { readonly projectId?: Id | null; readonly mine?: boolean } = {}): Result<BoardView, Refused> {
  if (!may(deps, actorId, "project.view") || !may(deps, actorId, "task.view")) return err("forbidden");
  const project = filter.projectId ? deps.projects.get(filter.projectId) : null;
  if (filter.projectId && !project) return err("not-found");
  const today = deps.today();
  const since = `${Temporal.PlainDate.from(today).subtract({ days: DONE_DAYS }).toString()}T00:00:00.000Z`;
  const mine = filter.mine === true;
  const rows = (project ? deps.tasks.listFor(project.id).filter((task) => task.status !== "done" || (task.doneAt ?? "") >= since) : deps.tasks.listBoard(since)).filter(
    (task) => !mine || task.assigneeId === actorId,
  );
  const query = mine ? "?mine=1" : "";
  return ok({
    project: project ? { id: project.id, name: project.name } : null,
    mine,
    columns: TASK_STATUSES.map((status) => ({
      status,
      label: TASK_STATUS_LABELS[status] ?? status,
      cards: cards(
        deps,
        rows.filter((task) => task.status === status).sort(byUrgency),
        today,
      ),
    })),
    total: rows.length,
    canMove: may(deps, actorId, "task.edit"),
    statuses: options(TASK_STATUS_LABELS),
    returnTo: project ? `/projects/${project.id}/board${query}` : `/board${query}`,
  });
}

export type ActiveProjectsView = {
  readonly items: readonly { readonly id: string; readonly name: string; readonly clientName: string; readonly health: string; readonly healthLabel: string; readonly next: string; readonly nextOverdue: boolean }[];
};

/** The dashboard's active projects panel. Demo clients' projects are left out. */
export function activeProjects(deps: ProjectsDeps, actorId: Id | null): Result<ActiveProjectsView, "forbidden"> {
  const list = listProjects(deps, actorId, { status: "active", withoutDemos: true });
  if (!list.ok) return list;
  return ok({ items: list.value.projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName, health: p.health, healthLabel: p.healthLabel, next: p.next, nextOverdue: p.nextOverdue })) });
}

export type DeadlinesView = {
  readonly days: number;
  readonly items: readonly { readonly key: string; readonly kind: string; readonly title: string; readonly href: string; readonly projectName: string; readonly dueOn: string; readonly dueText: string; readonly overdue: boolean }[];
};

/** Open milestones and tasks of active projects due within `days`, or already late, soonest first. Demo clients' are left out. */
export function upcomingDeadlines(deps: ProjectsDeps, actorId: Id | null, days = 14): Result<DeadlinesView, "forbidden"> {
  if (!may(deps, actorId, "project.view")) return err("forbidden");
  const today = deps.today();
  const demo = demoProjects(deps);
  const until = Temporal.PlainDate.from(today).add({ days }).toString();
  const milestones = deps.milestones
    .listOpen()
    .filter((milestone) => milestone.dueOn !== null && milestone.dueOn <= until && !demo.has(milestone.projectId))
    .map((milestone) => ({ key: `m-${milestone.id}`, kind: "Milestone", title: milestone.name, href: `/projects/${milestone.projectId}`, projectName: milestone.projectName, dueOn: milestone.dueOn ?? "", dueText: milestone.dueOn ? dueText(milestone.dueOn, today) : "", overdue: isMilestoneOverdue(milestone, today) }));
  const tasks = may(deps, actorId, "task.view")
    ? deps.tasks
        .listBoard("9999")
        .filter((task) => task.status !== "done" && task.dueOn !== null && task.dueOn <= until && !demo.has(task.projectId))
        .map((task) => ({ key: `t-${task.id}`, kind: "Task", title: task.title, href: `/tasks/${task.id}`, projectName: task.projectName, dueOn: task.dueOn ?? "", dueText: task.dueOn ? dueText(task.dueOn, today) : "", overdue: isTaskOverdue(task, today) }))
    : [];
  return ok({ days, items: [...milestones, ...tasks].sort((a, b) => (a.dueOn === b.dueOn ? a.title.localeCompare(b.title) : a.dueOn < b.dueOn ? -1 : 1)) });
}

export type ProjectHealthReportView = {
  readonly statuses: readonly { readonly label: string; readonly count: number }[];
  readonly healths: readonly { readonly label: string; readonly count: number }[];
  readonly active: number;
  readonly late: readonly { readonly key: string; readonly kind: string; readonly title: string; readonly href: string; readonly projectName: string; readonly dueOn: string; readonly dueText: string }[];
  readonly attention: readonly { readonly id: string; readonly name: string; readonly clientName: string; readonly healthLabel: string; readonly next: string }[];
};

/** The project health report. Demo clients' projects are left out. Permission: `report.view` and `project.view`. */
export function projectHealthReport(deps: ProjectsDeps, actorId: Id | null): Result<ProjectHealthReportView, "forbidden"> {
  if (!may(deps, actorId, "report.view") || !may(deps, actorId, "project.view")) return err("forbidden");
  const today = deps.today();
  const all = deps.projects.list().filter((project) => !project.demo);
  const demo = demoProjects(deps);
  const active = all.filter((project) => project.status === "active");
  const lateMilestones = deps.milestones
    .listOpen()
    .filter((milestone) => isMilestoneOverdue(milestone, today) && !demo.has(milestone.projectId))
    .map((milestone) => ({ key: `m-${milestone.id}`, kind: "Milestone", title: milestone.name, href: `/projects/${milestone.projectId}`, projectName: milestone.projectName, dueOn: milestone.dueOn ?? "", dueText: milestone.dueOn ? dueText(milestone.dueOn, today) : "" }));
  const lateTasks = deps.tasks
    .listBoard("9999")
    .filter((task) => isTaskOverdue(task, today) && !demo.has(task.projectId))
    .map((task) => ({ key: `t-${task.id}`, kind: "Task", title: task.title, href: `/tasks/${task.id}`, projectName: task.projectName, dueOn: task.dueOn ?? "", dueText: task.dueOn ? dueText(task.dueOn, today) : "" }));
  return ok({
    statuses: PROJECT_STATUSES.map((status) => ({ label: STATUS_LABELS[status] ?? status, count: all.filter((project) => project.status === status).length })),
    healths: Object.keys(HEALTH_LABELS).map((health) => ({ label: HEALTH_LABELS[health] ?? health, count: active.filter((project) => project.health === health).length })),
    active: active.length,
    late: [...lateMilestones, ...lateTasks].sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
    attention: active
      .filter((project) => project.health !== "on-track")
      .map((project) => {
        const next = nextMilestone(deps.milestones.listFor(project.id));
        return { id: project.id, name: project.name, clientName: project.clientName, healthLabel: HEALTH_LABELS[project.health] ?? project.health, next: next ? (next.dueOn ? `${next.name}, due ${dueText(next.dueOn, today)}` : next.name) : "" };
      }),
  });
}

/** The projects of demo clients, by id. */
function demoProjects(deps: ProjectsDeps): ReadonlySet<string> {
  return new Set(deps.projects.list().filter((project) => project.demo).map((project) => project.id));
}

export type ProjectLinksView = {
  readonly items: readonly { readonly id: string; readonly name: string; readonly kindLabel: string; readonly url: string; readonly host: string; readonly shared: boolean }[];
  readonly canEdit: boolean;
  readonly kinds: readonly { readonly value: string; readonly label: string }[];
};

/** A project's links, for its page. Permission: `project.view`. */
export function projectLinks(deps: ProjectsDeps, actorId: Id | null, projectId: Id): Result<ProjectLinksView, "forbidden"> {
  if (!may(deps, actorId, "project.view")) return err("forbidden");
  return ok({
    items: deps.links.listFor(projectId).map((one) => ({ id: one.id, name: linkName(one), kindLabel: LINK_KIND_LABELS[one.kind], url: one.url, host: new URL(one.url).host, shared: one.shared })),
    canEdit: may(deps, actorId, "project.edit"),
    kinds: LINK_KINDS.map((value) => ({ value, label: LINK_KIND_LABELS[value] })),
  });
}
