import type { ProjectLink } from "../domain/link.ts";
import type { Baseline } from "../domain/baseline.ts";
import type { Deliverable } from "../domain/deliverable.ts";
import type { Label } from "../domain/label.ts";
import type { Comment } from "../domain/comment.ts";
import type { ShareLink } from "../domain/share.ts";
import type { ImportPlan } from "../domain/task-import.ts";
import type { Repeat } from "../domain/repeat.ts";
import type { SavedFilter } from "../domain/saved-filter.ts";
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

/** What a task row holds beyond the Task itself: a to-do's client, and who added it. */
export type TaskOrigin = { readonly organizationId?: Id | null; readonly opportunityId?: Id | null; readonly createdBy?: Id | null; /** The task it is a subtask of. */ readonly parentId?: Id | null };

/** An import waiting to be said yes to (decision 0007, section 13). One per person. */
export type PendingImport = { readonly id: Id; readonly userId: Id; readonly projectId: Id; readonly plan: ImportPlan; readonly createdAt: string };

export type ImportStore = {
  /** Keeps it, replacing any the person had waiting. */
  save(pending: PendingImport): void;
  get(id: Id): PendingImport | null;
  remove(id: Id): void;
  /** Removes any made before this instant. */
  removeOlderThan(at: string): void;
};

/** Share links (decision 0007, section 11). */
export type ShareRow = ShareLink & { readonly createdByName: string; readonly visits: number; readonly lastVisitedAt: string | null };

export type ShareStore = {
  insert(link: ShareLink, tokenHash: string): void;
  get(id: Id): ShareLink | null;
  byHash(tokenHash: string): ShareLink | null;
  /** A project's links, newest first. */
  forProject(projectId: Id): ShareRow[];
  stop(id: Id, by: Id, at: string): void;
  visited(id: Id, at: string): void;
};

/** Each person's calendar address (decision 0007, section 10). */
export type CalendarFeed = { readonly userId: Id; readonly tokenHash: string; readonly filterId: Id | null; readonly createdAt: string; readonly lastUsedAt: string | null };

export type CalendarFeedStore = {
  forUser(userId: Id): CalendarFeed | null;
  byHash(tokenHash: string): CalendarFeed | null;
  /** Saves a person's feed, replacing any they had. */
  save(feed: CalendarFeed): void;
  remove(userId: Id): void;
  used(userId: Id, at: string): void;
};

/** Secrets for calendar addresses and share links: made at random, kept only as a hash. */
export type FeedTokens = { newToken(): string; hash(token: string): string };

/** Repeating tasks (decision 0007, section 7). */
export type RepeatStore = {
  get(taskId: Id): Repeat | null;
  /** Null stops it repeating. */
  set(taskId: Id, repeat: Repeat | null, at: string): void;
  /** Several tasks' repeats at once. A task that doesn't repeat is missing. */
  forTasks(taskIds: readonly Id[]): Map<Id, Repeat>;
  setPrevious(taskId: Id, previousId: Id): void;
  /** The task whose finishing made this one. */
  previousOf(taskId: Id): Id | null;
  /** The task this one's finishing made. */
  nextOf(taskId: Id): Id | null;
  /** A to-do's client and opportunity, carried to the next one. */
  todoPlace(taskId: Id): { readonly organizationId: Id | null; readonly opportunityId: Id | null };
};

/** Comments on tasks (decision 0007, section 6). */
export type CommentStore = {
  insert(comment: Comment): void;
  update(comment: Comment): void;
  remove(id: Id): void;
  get(id: Id): Comment | null;
  /** A task's comments, oldest first, with each author's name (or the visitor's) and the share link it came through, if any. */
  forTask(taskId: Id): (Comment & { readonly authorName: string; readonly shareLabel: string })[];
  /** A project's comments that came through share links, oldest first. */
  fromLinks(projectId: Id): (Comment & { readonly authorName: string; readonly shareLabel: string })[];
  /** The client a task's files belong to: its project's, or a to-do's own. */
  organizationOf(taskId: Id): Id | null;
};

/** Subtasks and blocking (decision 0007, section 5). */
export type TaskLinkStore = {
  /** The task this one is a subtask of, or null. */
  parentOf(taskId: Id): Id | null;
  /** A task's subtasks, oldest first. */
  subtasks(parentId: Id): TaskRow[];
  /** Several tasks' subtasks counted, by parent id. A task with none is missing. */
  progress(parentIds: readonly Id[]): Map<Id, { readonly done: number; readonly total: number }>;
  block(blockedId: Id, blockerId: Id, by: Id, at: string): void;
  /** False if it wasn't blocked by that task. */
  unblock(blockedId: Id, blockerId: Id): boolean;
  /** The ids a task waits on, done or not. */
  blockersOf(taskId: Id): Id[];
  /** What a task waits on, as rows. */
  waitingOn(taskId: Id): TaskRow[];
  /** What waits on a task, as rows. */
  holdingUp(taskId: Id): TaskRow[];
  /** How many unfinished tasks each of these waits on. A task waiting on none is missing. */
  openBlockers(taskIds: readonly Id[]): Map<Id, number>;
};

export type TaskStore = {
  insert(task: Task, at: string, origin?: TaskOrigin): void;
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

/** One task as the work table shows it: every task of an active project, and every to-do. */
export type WorkRow = Task & {
  readonly projectName: string;
  /** The project's client, or the to-do's. */
  readonly organizationId: Id | null;
  readonly clientName: string;
  readonly assigneeName: string;
};

/** The work table's reads, and the saved filters and column choices behind it (decision 0007, section 3). */
export type WorkStore = {
  rows(): WorkRow[];
  /** Clients that aren't former ones, by name, for quick add's "+client". */
  clients(): { readonly id: Id; readonly name: string }[];
  insertFilter(filter: SavedFilter, at: string): void;
  updateFilter(filter: SavedFilter, at: string): void;
  removeFilter(id: Id): void;
  getFilter(id: Id): SavedFilter | null;
  /** Someone's own filters and everyone's shared ones, by name. */
  filtersFor(personId: Id): SavedFilter[];
  /** Someone's chosen columns, comma separated, or "" for the default. */
  columns(personId: Id): string;
  setColumns(personId: Id, columns: string, at: string): void;
};
