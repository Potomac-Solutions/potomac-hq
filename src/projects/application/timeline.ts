// The timeline (decision 0007, section 9). One project's phases, milestones
// and tasks as bars from start to due, today marked; and every active
// project on one timeline. Drawn by the server: the screens get percentages.
import { TASK_STATUS_LABELS } from "../domain/labels.ts";
import { place, scaleFor, spanOf, spanText, type Placement, type Scale } from "../domain/timeline.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, type Id, type Result } from "../../shared/index.ts";
import type { ProjectsDeps, Refused } from "./commands.ts";

export type TimelineRow = {
  readonly key: string;
  readonly kind: "task" | "milestone" | "phase" | "project";
  readonly title: string;
  readonly href: string;
  /** "Nov 24 to Dec 5", "Due Dec 5". */
  readonly when: string;
  readonly status: string;
  readonly done: boolean;
  readonly overdue: boolean;
  /** A subtask, drawn indented. */
  readonly sub: boolean;
  readonly place: Placement;
  /** Points drawn on the same row: a project's milestones. */
  readonly marks: readonly { readonly key: string; readonly title: string; readonly at: number; readonly done: boolean }[];
};

export type TimelineGroup = { readonly key: string; readonly label: string; readonly bar: TimelineRow | null; readonly rows: readonly TimelineRow[] };

export type ProjectTimelineView = {
  readonly projectId: string;
  readonly projectName: string;
  readonly clientName: string;
  readonly scale: Scale | null;
  readonly groups: readonly TimelineGroup[];
  /** Tasks with no dates, so not drawn. */
  readonly undated: number;
};

const allowed = (deps: ProjectsDeps, actorId: Id | null): boolean => actorId !== null && authorize(deps, actorId, "project.view").ok && authorize(deps, actorId, "task.view").ok;

/** One project: a group per phase, then anything in no phase. */
export function projectTimeline(deps: ProjectsDeps, actorId: Id | null, projectId: Id): Result<ProjectTimelineView, Refused> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const project = deps.projects.list().find((one) => one.id === projectId);
  if (!project) return err("not-found");
  const today = deps.today();
  const tasks = deps.tasks.listFor(projectId);
  const milestones = deps.milestones.listFor(projectId);
  const phases = deps.phases.listFor(projectId);
  const subtasks = new Set(tasks.filter((task) => deps.taskLinks.parentOf(task.id) !== null).map((task) => task.id));
  const scale = scaleFor([project.startOn, project.targetOn, ...tasks.flatMap((task) => [task.startOn, task.dueOn]), ...milestones.map((one) => one.dueOn)], today);
  const taskRow = (task: (typeof tasks)[number]): TimelineRow | null => {
    const placed = scale ? place(scale, task.startOn, task.dueOn) : null;
    if (!placed) return null;
    const done = task.status === "done";
    return {
      key: `task-${task.id}`,
      kind: "task",
      title: task.title,
      href: `/tasks/${task.id}`,
      when: spanText(task.startOn, task.dueOn),
      status: TASK_STATUS_LABELS[task.status] ?? task.status,
      done,
      overdue: !done && task.dueOn !== null && task.dueOn < today,
      sub: subtasks.has(task.id),
      place: placed,
      marks: [],
    };
  };
  const milestoneRow = (one: (typeof milestones)[number]): TimelineRow | null => {
    const placed = scale ? place(scale, null, one.dueOn) : null;
    if (!placed) return null;
    const done = one.doneOn !== null;
    return { key: `milestone-${one.id}`, kind: "milestone", title: one.name, href: `/projects/${projectId}#milestones`, when: spanText(null, one.dueOn), status: done ? "Done" : "Milestone", done, overdue: !done && one.dueOn !== null && one.dueOn < today, sub: false, place: placed, marks: [] };
  };
  const group = (key: string, label: string, phaseId: Id | null): TimelineGroup => {
    const inPhase = tasks.filter((task) => task.phaseId === phaseId);
    const marks = milestones.filter((one) => one.phaseId === phaseId);
    const rows = [...marks.map(milestoneRow), ...inPhase.map(taskRow)].filter((row): row is TimelineRow => row !== null);
    rows.sort((a, b) => a.place.left - b.place.left || a.title.localeCompare(b.title));
    const span = spanOf([...inPhase.map((task) => ({ start: task.startOn, end: task.dueOn })), ...marks.map((one) => ({ start: null, end: one.dueOn }))]);
    const placed = scale && phaseId !== null && span.start !== span.end ? place(scale, span.start, span.end) : null;
    const bar: TimelineRow | null = placed ? { key: `phase-${key}`, kind: "phase", title: label, href: "", when: spanText(span.start, span.end, "Ends"), status: "", done: false, overdue: false, sub: false, place: placed, marks: [] } : null;
    return { key, label, bar, rows };
  };
  const groups = [...phases.map((phase) => group(phase.id, phase.name, phase.id)), group("none", phases.length > 0 ? "No phase" : "Tasks and milestones", null)].filter((one) => one.rows.length > 0);
  // The project's own dates, when it has them, on top.
  const whole = scale ? place(scale, project.startOn, project.targetOn) : null;
  if (whole) {
    const late = project.targetOn !== null && project.targetOn < today;
    groups.unshift({ key: "project", label: "", bar: null, rows: [{ key: `project-${projectId}`, kind: "project", title: "The whole project", href: `/projects/${projectId}`, when: spanText(project.startOn, project.targetOn, "Target"), status: "", done: false, overdue: late, sub: false, place: whole, marks: [] }] });
  }
  return ok({
    projectId,
    projectName: project.name,
    clientName: project.clientName,
    scale,
    groups,
    undated: tasks.filter((task) => task.startOn === null && task.dueOn === null).length,
  });
}

export type ProjectsTimelineView = { readonly scale: Scale | null; readonly rows: readonly TimelineRow[]; readonly undated: number };

/**
 * Every active project, demos left out: a bar from its start to its target
 * date, or across its tasks' dates when those aren't set, with its
 * milestones marked on it.
 */
export function projectsTimeline(deps: ProjectsDeps, actorId: Id | null): Result<ProjectsTimelineView, "forbidden"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const today = deps.today();
  const projects = deps.projects.list().filter((one) => one.status === "active" && !one.demo);
  const spans = projects.map((project) => {
    const tasks = deps.tasks.listFor(project.id);
    const milestones = deps.milestones.listFor(project.id);
    const fromParts = spanOf([...tasks.map((task) => ({ start: task.startOn, end: task.dueOn })), ...milestones.map((one) => ({ start: null, end: one.dueOn }))]);
    const start = project.startOn ?? fromParts.start;
    const end = project.targetOn ?? fromParts.end;
    return { project, start, end: end !== null && start !== null && end < start ? start : end, milestones };
  });
  const scale = scaleFor(spans.flatMap((one) => [one.start, one.end, ...one.milestones.map((m) => m.dueOn)]), today);
  const rows: TimelineRow[] = [];
  let undated = 0;
  for (const one of spans) {
    const placed = scale ? place(scale, one.start, one.end) : null;
    if (!placed || !scale) {
      undated += 1;
      continue;
    }
    rows.push({
      key: `project-${one.project.id}`,
      kind: "project",
      title: one.project.name,
      href: `/projects/${one.project.id}/timeline`,
      when: `${one.project.clientName}. ${spanText(one.start, one.end, "Target")}`,
      status: "",
      done: false,
      overdue: one.end !== null && one.end < today,
      sub: false,
      place: placed,
      marks: one.milestones.flatMap((m) => {
        const at = place(scale, null, m.dueOn);
        return at ? [{ key: m.id, title: `${m.name}, ${spanText(null, m.dueOn)}${m.doneOn ? ", done" : ""}`, at: at.left, done: m.doneOn !== null }] : [];
      }),
    });
  }
  rows.sort((a, b) => a.place.left - b.place.left || a.title.localeCompare(b.title));
  return ok({ scale, rows, undated });
}
