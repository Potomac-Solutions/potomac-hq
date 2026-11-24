// Quick add (decision 0007, section 4): one line of text becomes a task or a
// to-do. The domain reads the line (../domain/quick-add.ts); here its handles
// become people, projects, clients and labels, the page shows what was
// understood, and saving makes the task, any new labels, and their events in
// one transaction.
//
// "+handle" is a project first, then a client: a project gives a project
// task, a client (or nothing) gives a to-do. A to-do is always someone's, so
// with no "@" it is the adder's; a project task with no "@" is no one's yet,
// as when it is added on the project page. A part that matches no one, or
// more than one, stops the save until it is removed or the text is fixed.
import { PRIORITY_LABELS } from "../domain/labels.ts";
import { handleOf, matchHandle, parseQuickAdd, QUICK_ADD_MAX, type QuickPart } from "../domain/quick-add.ts";
import { newTask, type TaskError } from "../domain/task.ts";
import { repeatText, type Repeat } from "../domain/repeat.ts";
import { authorize } from "../../identity/index.ts";
import { dueText, err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import { makeLabel, type ProjectsDeps, type Refused } from "./commands.ts";
import type { LabelError } from "../domain/label.ts";

export type QuickAddInput = {
  readonly text: string;
  /** Indexes of parts to leave in the title. */
  readonly skip: readonly number[];
};

export type QuickAddPart = {
  readonly kind: QuickPart["kind"];
  readonly words: string;
  /** What it sets, in words: "Due Fri, Nov 27, in 3 days". */
  readonly says: string;
  /** Why it can't be used, or empty. */
  readonly problem: string;
  /** The same page with this part left in the title. */
  readonly removeHref: string;
};

export type QuickAddView = {
  readonly text: string;
  /** The skipped parts, comma separated, for the save form. */
  readonly skip: string;
  readonly title: string;
  /** Project task or to-do, in words. */
  readonly kind: string;
  readonly parts: readonly QuickAddPart[];
  readonly canSave: boolean;
  /** Why it can't be saved, when no part says. */
  readonly problem: string;
  /** Something was typed. */
  readonly typed: boolean;
};

type Understood = {
  readonly title: string;
  readonly parts: readonly (QuickPart & { readonly says: string; readonly problem: string })[];
  readonly projectId: Id | null;
  readonly organizationId: Id | null;
  readonly assigneeId: Id | null;
  readonly priority: string | null;
  readonly dueOn: string | null;
  readonly labelIds: readonly Id[];
  readonly newLabels: readonly string[];
  readonly repeat: Repeat | null;
};

const allowed = (deps: ProjectsDeps, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "task.edit").ok;
/** "A or B", "A, B or C", in name order. */
function list(unsorted: readonly string[]): string {
  const names = [...unsorted].sort((a, b) => a.localeCompare(b));
  return names.length <= 2 ? names.join(" or ") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/** Reads the line and finds who and what its handles mean. */
function understand(deps: ProjectsDeps, actorId: Id, input: QuickAddInput): Understood {
  const today = deps.today();
  const read = parseQuickAdd(input.text, today, new Set(input.skip));
  let projectId: Id | null = null;
  let organizationId: Id | null = null;
  let assigneeId: Id | null = null;
  let priority: string | null = null;
  let dueOn: string | null = null;
  let repeat: Repeat | null = null;
  const labelIds: Id[] = [];
  const newLabels: string[] = [];
  const parts = read.parts.map((part) => {
    switch (part.kind) {
      case "due":
        dueOn = part.on;
        return { ...part, says: `Due ${dueText(part.on, today)}`, problem: "" };
      case "repeat":
        repeat = part.repeat;
        return { ...part, says: `Repeats ${repeatText(part.repeat).replace(/^Every/, "every")}`, problem: "" };
      case "priority":
        priority = part.priority;
        return { ...part, says: `${PRIORITY_LABELS[part.priority]} priority`, problem: "" };
      case "person": {
        const people = deps.users.list().filter((user) => user.status === "active");
        const found = matchHandle(part.handle, people, (user) => [user.name, user.name.split(/\s+/)[0] ?? "", user.email.split("@")[0] ?? ""]);
        if (found.length === 1) {
          assigneeId = (found[0] as (typeof people)[number]).id;
          return { ...part, says: `For ${(found[0] as (typeof people)[number]).name}`, problem: "" };
        }
        return { ...part, says: "", problem: found.length === 0 ? `No one here goes by ${part.words}.` : `${part.words} could be ${list(found.map((user) => user.name))}.` };
      }
      case "project": {
        const projects = deps.projects.list().filter((project) => project.status === "active");
        const found = matchHandle(part.handle, projects, (project) => [project.name]);
        if (found.length === 1) {
          const project = found[0] as (typeof projects)[number];
          projectId = project.id;
          return { ...part, says: `In ${project.name} (${project.clientName})`, problem: "" };
        }
        if (found.length > 1) return { ...part, says: "", problem: `${part.words} could be ${list(found.map((project) => project.name))}.` };
        const clients = matchHandle(part.handle, deps.work.clients(), (client) => [client.name]);
        if (clients.length === 1) {
          const client = clients[0] as { readonly id: Id; readonly name: string };
          organizationId = client.id;
          return { ...part, says: `About ${client.name}, as a to-do`, problem: "" };
        }
        return { ...part, says: "", problem: clients.length === 0 ? `No open project or client goes by ${part.words}.` : `${part.words} could be ${list(clients.map((client) => client.name))}.` };
      }
      case "label": {
        const found = deps.labels.list().find((label) => handleOf(label.name) === part.handle);
        if (found) {
          labelIds.push(found.id);
          return { ...part, says: `Label ${found.name}`, problem: "" };
        }
        newLabels.push(part.name);
        return { ...part, says: `New label ${part.name}`, problem: "" };
      }
    }
  });
  if (projectId === null) assigneeId ??= actorId;
  return { title: read.title, parts, projectId, organizationId, assigneeId, priority, dueOn, labelIds, newLabels, repeat };
}

const address = (text: string, skip: readonly number[]) => {
  const params = new URLSearchParams({ text });
  for (const index of [...skip].sort((a, b) => a - b)) params.append("skip", String(index));
  return `/add?${params}`;
};

/** Reads `skip` as the page and the form send it: repeated, or comma separated. */
export function readSkip(values: readonly string[]): number[] {
  return [...new Set(values.flatMap((value) => value.split(",")).map((value) => Number.parseInt(value, 10)).filter((value) => Number.isInteger(value) && value >= 0 && value < QUICK_ADD_MAX))];
}

/** What a line would add, before it is saved. */
export function quickAddPreview(deps: ProjectsDeps, actorId: Id | null, input: QuickAddInput): Result<QuickAddView, "forbidden"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const text = input.text.slice(0, QUICK_ADD_MAX).trim();
  if (text === "") return ok({ text: "", skip: "", title: "", kind: "", parts: [], canSave: false, problem: "", typed: false });
  const seen = understand(deps, actorId, { text, skip: input.skip });
  const problem = seen.title === "" ? "Add some words for the title, beside what sets the fields." : "";
  return ok({
    text,
    skip: [...input.skip].sort((a, b) => a - b).join(","),
    title: seen.title,
    kind: seen.projectId ? "A task" : "A to-do",
    parts: seen.parts.map((part) => ({ kind: part.kind, words: part.words, says: part.says, problem: part.problem, removeHref: address(text, [...input.skip, part.index]) })),
    canSave: problem === "" && seen.parts.every((part) => part.problem === ""),
    problem,
    typed: true,
  });
}

export type QuickAddError = Refused | "not-understood" | "project-closed" | "person-not-found" | "name-taken" | TaskError | LabelError;

/** Adds what the line says: a project task or a to-do, with its labels. */
export function quickAdd(deps: ProjectsDeps, actorId: Id | null, input: QuickAddInput): Result<{ readonly id: Id; readonly title: string; readonly href: string }, QuickAddError> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const seen = understand(deps, actorId, { text: input.text.slice(0, QUICK_ADD_MAX), skip: input.skip });
    if (seen.parts.some((part) => part.problem !== "")) return err("not-understood");
    if (seen.projectId && deps.projects.get(seen.projectId)?.status !== "active") return err("project-closed");
    if (seen.assigneeId && deps.users.get(seen.assigneeId)?.status !== "active") return err("person-not-found");
    const made = newTask(deps.newId(), seen.projectId, { title: seen.title, assigneeId: seen.assigneeId, priority: seen.priority, dueOn: seen.dueOn });
    if (!made.ok) return made;
    const task = made.value;
    deps.tasks.insert(task, deps.clock(), { organizationId: seen.projectId ? null : seen.organizationId, createdBy: actorId });
    if (task.projectId) {
      recordActivity(deps, { actorId, action: "task.added", recordType: "task", recordId: task.id, context: { projectId: task.projectId, title: task.title, assigneeId: task.assigneeId, quick: true } });
    } else {
      recordActivity(deps, {
        actorId,
        action: "todo.added",
        recordType: "todo",
        recordId: task.id,
        context: { assigneeId: task.assigneeId, ...(task.dueOn ? { dueOn: task.dueOn } : {}), ...(seen.organizationId ? { clientId: seen.organizationId } : {}), quick: true },
      });
    }
    if (seen.repeat) deps.repeats.set(task.id, seen.repeat, deps.clock());
    const labelIds = [...seen.labelIds];
    for (const name of seen.newLabels) {
      const label = makeLabel(deps, actorId, { name, colour: null });
      if (!label.ok) return label;
      labelIds.push(label.value.id);
    }
    if (labelIds.length > 0) {
      deps.labels.setForTask(task.id, labelIds);
      const names = labelIds.map((id) => deps.labels.get(id)?.name ?? "");
      recordActivity(deps, { actorId, action: "task.labelled", recordType: "task", recordId: task.id, context: { projectId: task.projectId, title: task.title, added: names, removed: [] } });
    }
    return ok({ id: task.id, title: task.title, href: `/tasks/${task.id}` });
  });
}
