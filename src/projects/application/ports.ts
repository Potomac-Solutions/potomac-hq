import type { ProjectLink } from "../domain/link.ts";
import type { Baseline } from "../domain/baseline.ts";
import type { Deliverable } from "../domain/deliverable.ts";
import type { Label } from "../domain/label.ts";
import type { Milestone, Phase } from "../domain/plan.ts";
import type { Project } from "../domain/project.ts";
import type { Task } from "../domain/task.ts";
import type { Id } from "../../shared/index.ts";

export type ProjectRow = Project & { readonly clientName: string; readonly ownerName: string; readonly openTasks: number; /** Its client is a demo. */ readonly demo: boolean };

export type ProjectStore = {
  insert(project: Project, at: string): void;
  update(project: Project, at: string): void;
  get(id: Id): Project | null;
  byOpportunity(opportunityId: Id): Project | null;
  /** Every project with its client's and owner's names, newest first. */
  list(): ProjectRow[];
  /** One client's projects, newest first. */
  listFor(organizationId: Id): Project[];
};

export type PhaseStore = {
  insert(phase: Phase, at: string): void;
  get(id: Id): Phase | null;
  /** A project's phases in order. */
  listFor(projectId: Id): Phase[];
};

export type MilestoneStore = {
  insert(milestone: Milestone, at: string): void;
  update(milestone: Milestone, at: string): void;
  get(id: Id): Milestone | null;
  listFor(projectId: Id): Milestone[];
  /** Every open milestone of every active project, with the project's name. */
  listOpen(): (Milestone & { readonly projectName: string })[];
};

export type TaskRow = Task & { readonly projectName: string; readonly assigneeName: string | null };

export type TaskStore = {
  insert(task: Task, at: string): void;
  update(task: Task, at: string): void;
  get(id: Id): Task | null;
  /** One task with its project's and assignee's names. A to-do's project name is empty. */
  row(id: Id): TaskRow | null;
  listFor(projectId: Id): TaskRow[];
  /** Tasks of active projects: every open one, and those finished at or after `doneSince`. */
  listBoard(doneSince: string): TaskRow[];
};

export type DeliverableRow = Deliverable & { readonly fileName: string; readonly fileSize: number };

export type DeliverableStore = {
  insert(deliverable: Deliverable, at: string): void;
  update(deliverable: Deliverable, at: string): void;
  get(id: Id): Deliverable | null;
  listFor(projectId: Id): DeliverableRow[];
  /** Notes which client user made the decision on a deliverable. */
  recordDecider(id: Id, clientUserId: Id): void;
};

export type ProjectLinkStore = {
  insert(link: ProjectLink, at: string): void;
  get(id: Id): ProjectLink | null;
  remove(id: Id): void;
  /** A project's links, in the order they were added. */
  listFor(projectId: Id): ProjectLink[];
};

export type HistoryRow = { readonly id: string; readonly occurredAt: string; readonly action: string; readonly actorName: string | null };

export type ProjectHistory = {
  /** Events on the project and on anything that belongs to it, newest first. */
  forProject(projectId: Id, limit: number): HistoryRow[];
};

export type BaselineStore = {
  /** Sets a project's baseline, replacing any it had. */
  set(baseline: Baseline, at: string): void;
  get(projectId: Id): Baseline | null;
};

export type LabelRow = Label & { /** How many tasks have it. */ readonly tasks: number };

export type LabelStore = {
  insert(label: Label, at: string): void;
  update(label: Label, at: string): void;
  /** Deletes a label and takes it off every task. */
  remove(id: Id): void;
  get(id: Id): Label | null;
  /** The label with this name, whatever its capitals and spaces. */
  byName(name: string): Label | null;
  /** Every label, with how many tasks have it, by name. */
  list(): LabelRow[];
  /** One task's labels, by name. */
  forTask(taskId: Id): Label[];
  /** Several tasks' labels at once, by task id. A task with none is missing from the map. */
  forTasks(taskIds: readonly Id[]): Map<Id, Label[]>;
  /** Replaces a task's labels with these. */
  setForTask(taskId: Id, labelIds: readonly Id[]): void;
};
