// Importing tasks from Trello and Todoist (decision 0007, section 13), into
// an open project. The export is read into a plan and shown first; saying yes
// makes every task, subtask and new label in one transaction, through the
// same events as adding them by hand, so nothing is half-done. Needs
// `task.edit` and `project.edit`.
import { labelKey } from "../domain/label.ts";
import { PRIORITY_LABELS, TASK_STATUS_LABELS } from "../domain/labels.ts";
import { repeatText } from "../domain/repeat.ts";
import { readTodoist, readTrello, type ImportError, type ImportSource } from "../domain/task-import.ts";
import { newTask, type Task } from "../domain/task.ts";
import { authorize } from "../../identity/index.ts";
import { dueText, err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import { makeLabel, type ProjectsDeps, type Refused } from "./commands.ts";

const mayImport = (deps: ProjectsDeps, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "task.edit").ok && authorize(deps, actorId, "project.edit").ok;

export const canImportTasks = (deps: ProjectsDeps, actorId: Id | null): boolean => mayImport(deps, actorId);

const SOURCE_NAMES: Record<ImportSource, string> = { trello: "Trello", todoist: "Todoist" };
/** Exports bigger than this aren't read. */
const MAX_BYTES = 10 * 1024 * 1024;

export type ImportUploadError = Refused | "project-closed" | "invalid-source" | "file-missing" | "export-too-large" | ImportError;

/** Reads an export into a plan and keeps it for the preview, replacing any the person had waiting. */
export function planTaskImport(
  deps: ProjectsDeps,
  actorId: Id | null,
  projectId: Id,
  input: { readonly source: string; readonly file: { readonly name: string; readonly bytes: Uint8Array } | null },
): Result<{ readonly importId: Id }, ImportUploadError> {
  if (!mayImport(deps, actorId)) return err("forbidden");
  const project = deps.projects.get(projectId);
  if (!project) return err("not-found");
  if (project.status !== "active") return err("project-closed");
  if (input.source !== "trello" && input.source !== "todoist") return err("invalid-source");
  if (!input.file || input.file.bytes.length === 0) return err("file-missing");
  if (input.file.bytes.length > MAX_BYTES) return err("export-too-large");
  const text = new TextDecoder("utf-8", { fatal: false }).decode(input.file.bytes);
  const plan = input.source === "trello" ? readTrello(text, deps.zone) : readTodoist(text, deps.today());
  if (!plan.ok) return plan;
  const now = deps.clock();
  const id = deps.newId();
  deps.transact(() => {
    deps.imports.removeOlderThan(Temporal.Instant.from(now).subtract({ hours: 24 }).toString());
    deps.imports.save({ id, userId: actorId, projectId, plan: plan.value, createdAt: now });
  });
  return ok({ importId: id });
}

export type ImportPreviewView = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly source: string;
  readonly boardName: string;
  readonly tasks: number;
  readonly subtasks: number;
  readonly byStatus: readonly { readonly label: string; readonly count: number }[];
  readonly labels: readonly { readonly name: string; readonly isNew: boolean }[];
  readonly rows: readonly { readonly key: string; readonly title: string; readonly from: string; readonly status: string; readonly due: string; readonly priority: string; readonly labels: string; readonly subtasks: number; readonly repeat: string }[];
  /** More tasks than the rows show. */
  readonly more: number;
  readonly skipped: readonly string[];
  readonly notes: readonly string[];
};

const ROWS_SHOWN = 100;

/** What an import would make. Only the person who uploaded it sees it. */
export function taskImportPreview(deps: ProjectsDeps, actorId: Id | null, importId: Id): Result<ImportPreviewView, Refused> {
  if (!mayImport(deps, actorId)) return err("forbidden");
  const pending = deps.imports.get(importId);
  if (!pending || pending.userId !== actorId) return err("not-found");
  const project = deps.projects.get(pending.projectId);
  if (!project) return err("not-found");
  const { plan } = pending;
  const today = deps.today();
  const existing = new Set(deps.labels.list().map((label) => labelKey(label.name)));
  const byStatus = (["todo", "doing", "blocked", "done"] as const)
    .map((status) => ({ label: TASK_STATUS_LABELS[status] ?? status, count: plan.tasks.filter((task) => task.status === status).length }))
    .filter((one) => one.count > 0);
  return ok({
    id: pending.id,
    projectId: project.id,
    projectName: project.name,
    source: SOURCE_NAMES[plan.source],
    boardName: plan.name,
    tasks: plan.tasks.length,
    subtasks: plan.tasks.reduce((sum, task) => sum + task.subtasks.length, 0),
    byStatus,
    labels: plan.labels.map((label) => ({ name: label.name, isNew: !existing.has(labelKey(label.name)) })),
    rows: plan.tasks.slice(0, ROWS_SHOWN).map((task, n) => ({
      key: String(n),
      title: task.title,
      from: task.from,
      status: TASK_STATUS_LABELS[task.status] ?? task.status,
      due: task.dueOn ? dueText(task.dueOn, today) : "",
      priority: task.priority === "normal" ? "" : (PRIORITY_LABELS[task.priority] ?? task.priority),
      labels: task.labels.join(", "),
      subtasks: task.subtasks.length,
      repeat: repeatText(task.repeat),
    })),
    more: Math.max(0, plan.tasks.length - ROWS_SHOWN),
    skipped: plan.skipped,
    notes: plan.notes,
  });
}

/** Makes everything the plan says, all at once. */
export function applyTaskImport(deps: ProjectsDeps, actorId: Id | null, importId: Id): Result<{ readonly projectId: Id; readonly tasks: number; readonly subtasks: number; readonly labels: number }, Refused | "project-closed"> {
  if (!mayImport(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const pending = deps.imports.get(importId);
    if (!pending || pending.userId !== actorId) return err("not-found");
    const project = deps.projects.get(pending.projectId);
    if (!project) return err("not-found");
    if (project.status !== "active") return err("project-closed");
    const { plan } = pending;
    const at = deps.clock();
    const labelIds = new Map<string, Id>(deps.labels.list().map((label) => [labelKey(label.name), label.id]));
    let madeLabels = 0;
    const labelFor = (name: string, colour: string | null): Id => {
      const found = labelIds.get(labelKey(name));
      if (found) return found;
      const made = makeLabel(deps, actorId, { name, colour });
      // A name the label rules refuse would undo the whole import.
      if (!made.ok) throw new Error(`label ${name}: ${made.error}`);
      labelIds.set(labelKey(name), made.value.id);
      madeLabels += 1;
      return made.value.id;
    };
    const colours = new Map(plan.labels.map((label) => [labelKey(label.name), label.colour]));
    const add = (fields: { readonly title: string; readonly description?: string; readonly priority?: string; readonly dueOn: string | null }, status: Task["status"], parentId: Id | null): Task => {
      const made = newTask(deps.newId(), project.id, { title: fields.title, description: fields.description ?? "", priority: fields.priority ?? "normal", dueOn: fields.dueOn });
      if (!made.ok) throw new Error(`task ${fields.title}: ${made.error}`);
      const task: Task = { ...made.value, status, doneAt: status === "done" ? at : null };
      deps.tasks.insert(task, at, { createdBy: actorId, parentId });
      recordActivity(deps, { actorId, action: "task.added", recordType: "task", recordId: task.id, context: { projectId: project.id, title: task.title, assigneeId: null, imported: plan.source, ...(parentId ? { parentId } : {}) } });
      return task;
    };
    let subtasks = 0;
    for (const planned of plan.tasks) {
      const task = add(planned, planned.status, null);
      if (planned.labels.length > 0) deps.labels.setForTask(task.id, planned.labels.map((name) => labelFor(name, colours.get(labelKey(name)) ?? null)));
      if (planned.repeat) deps.repeats.set(task.id, planned.repeat, at);
      for (const sub of planned.subtasks) {
        add({ title: sub.title, dueOn: sub.dueOn }, sub.done ? "done" : "todo", task.id);
        subtasks += 1;
      }
    }
    deps.imports.remove(importId);
    recordActivity(deps, { actorId, action: "project.tasks-imported", recordType: "project", recordId: project.id, context: { projectId: project.id, source: plan.source, tasks: plan.tasks.length, subtasks, labels: madeLabels } });
    return ok({ projectId: project.id, tasks: plan.tasks.length, subtasks, labels: madeLabels });
  });
}

/** Throws the plan away. */
export function cancelTaskImport(deps: ProjectsDeps, actorId: Id | null, importId: Id): Result<{ readonly projectId: Id }, Refused> {
  if (!mayImport(deps, actorId)) return err("forbidden");
  const pending = deps.imports.get(importId);
  if (!pending || pending.userId !== actorId) return err("not-found");
  deps.transact(() => deps.imports.remove(importId));
  return ok({ projectId: pending.projectId });
}
