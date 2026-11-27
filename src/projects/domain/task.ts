// One piece of work on a project: who has it, how urgent it is, when it is
// due, how long it should take, and where it stands (roadmap v0.3). Tasks
// have no dependencies on each other.
import { calendarDate, optionalText, requiredText } from "../../shared/domain/fields.ts";
import { formatHours, parseHours } from "../../shared/domain/hours.ts";
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const TASK_STATUSES = ["todo", "doing", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type Task = {
  readonly id: Id;
  /** Null for a to-do: a task that belongs to no project (decision 0007, section 1). */
  readonly projectId: Id | null;
  readonly phaseId: Id | null;
  readonly title: string;
  readonly description: string;
  readonly assigneeId: Id | null;
  readonly priority: TaskPriority;
  /** YYYY-MM-DD. */
  readonly dueOn: string | null;
  /** When work starts, YYYY-MM-DD, for the timeline (decision 0007, section 9). Never after the due date. */
  readonly startOn: string | null;
  readonly estimateMinutes: number | null;
  readonly status: TaskStatus;
  /** When it was moved to done, or null. */
  readonly doneAt: string | null;
};

export type TaskInput = {
  readonly title: string;
  readonly description?: string | null;
  readonly assigneeId?: Id | null;
  readonly phaseId?: Id | null;
  readonly priority?: string | null;
  readonly dueOn?: string | null;
  /** Left out, an edit keeps the start date it had. */
  readonly startOn?: string | null;
  /** Hours, as people type them: "2", "1.5", "0.25". */
  readonly estimate?: string | null;
};

export type TaskError = "title-missing" | "title-too-long" | "description-too-long" | "invalid-priority" | "invalid-date" | "invalid-estimate" | "start-after-due";

export const isTaskStatus = (value: string): value is TaskStatus => (TASK_STATUSES as readonly string[]).includes(value);
const isPriority = (value: string): value is TaskPriority => (TASK_PRIORITIES as readonly string[]).includes(value);

/** An estimate in hours, as whole minutes. Empty is "no estimate". */
export function parseEstimate(text: string | null | undefined): Result<number | null, "invalid-estimate"> {
  const parsed = parseHours(text);
  return parsed.ok ? parsed : err("invalid-estimate");
}

export { formatHours, parseHours };

function fields(input: TaskInput, startWas: string | null = null): Result<Pick<Task, "title" | "description" | "assigneeId" | "phaseId" | "priority" | "dueOn" | "startOn" | "estimateMinutes">, TaskError> {
  const title = requiredText(input.title, 200);
  if (!title.ok) return err(title.error === "missing" ? "title-missing" : "title-too-long");
  const description = optionalText(input.description, 5000);
  if (!description.ok) return err("description-too-long");
  const priority = (input.priority ?? "").trim() || "normal";
  if (!isPriority(priority)) return err("invalid-priority");
  const due = (input.dueOn ?? "").trim();
  const dueOn = due === "" ? ok(null) : calendarDate(due);
  if (!dueOn.ok) return dueOn;
  const start = input.startOn === undefined ? (startWas ?? "") : (input.startOn ?? "").trim();
  const startOn = start === "" ? ok(null) : calendarDate(start);
  if (!startOn.ok) return startOn;
  if (startOn.value !== null && dueOn.value !== null && startOn.value > dueOn.value) return err("start-after-due");
  const estimate = parseEstimate(input.estimate);
  if (!estimate.ok) return estimate;
  return ok({
    title: title.value,
    description: description.value ?? "",
    assigneeId: input.assigneeId ?? null,
    phaseId: input.phaseId ?? null,
    priority,
    dueOn: dueOn.value,
    startOn: startOn.value,
    estimateMinutes: estimate.value,
  });
}

/** A new task starts as to do. */
export function newTask(id: Id, projectId: Id | null, input: TaskInput): Result<Task, TaskError> {
  const checked = fields(input);
  if (!checked.ok) return checked;
  return ok({ id, projectId, ...checked.value, status: "todo", doneAt: null });
}

export function editTask(task: Task, input: TaskInput): Result<Task, TaskError> {
  const checked = fields(input, task.startOn);
  if (!checked.ok) return checked;
  return ok({ ...task, ...checked.value });
}

/** Any status may follow any other, except that a to-do is only to do or done. Moving to done stamps the time; moving away clears it. */
export function moveTask(task: Task, to: string, at: string): Result<Task, "invalid-status" | "unchanged" | "todo-has-no-board"> {
  if (!isTaskStatus(to)) return err("invalid-status");
  // A to-do is to do or done. It shows on the board (decision 0021), but
  // only in those two columns: working on and blocked belong to a project.
  if (task.projectId === null && to !== "todo" && to !== "done") return err("todo-has-no-board");
  if (to === task.status) return err("unchanged");
  return ok({ ...task, status: to, doneAt: to === "done" ? at : null });
}

export const isTaskOverdue = (task: Task, today: string): boolean => task.status !== "done" && task.dueOn !== null && task.dueOn < today;

/** Urgent first, then by due date (none last), then by title. */
export function byUrgency(a: Task, b: Task): number {
  const rank = TASK_PRIORITIES.indexOf(b.priority) - TASK_PRIORITIES.indexOf(a.priority);
  if (rank !== 0) return rank;
  if (a.dueOn !== b.dueOn) {
    if (a.dueOn === null) return 1;
    if (b.dueOn === null) return -1;
    return a.dueOn < b.dueOn ? -1 : 1;
  }
  return a.title.localeCompare(b.title);
}
