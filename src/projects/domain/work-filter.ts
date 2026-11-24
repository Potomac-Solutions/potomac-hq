// Filters for the work table (decision 0007, section 3). A filter is made of
// fields, never free text that is run: projects, clients, people, labels,
// statuses, priorities, when it is due and words in the title. It lives in
// the page's address, so a filter is a link, and a saved filter is that
// address with a name.
import type { Id } from "../../shared/domain/id.ts";
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from "./task.ts";

/** When a task is due, in windows a person thinks in. Weeks run Monday to Sunday. */
export const DUE_WINDOWS = ["overdue", "today", "this-week", "next-week", "later", "none"] as const;
export type DueWindow = (typeof DUE_WINDOWS)[number];

/** Which tasks by whether they are finished. */
export const SHOW = ["open", "done", "all"] as const;
export type Show = (typeof SHOW)[number];

/** The people choice also takes "me" (whoever is looking) and "nobody" (no one has it yet). */
export type WhoChoice = Id | "me" | "nobody";

export type WorkFilter = {
  readonly projects: readonly Id[];
  /** Includes to-dos, which have no project. */
  readonly noProject: boolean;
  readonly clients: readonly Id[];
  readonly who: readonly WhoChoice[];
  readonly labels: readonly Id[];
  readonly statuses: readonly TaskStatus[];
  readonly priorities: readonly TaskPriority[];
  readonly due: readonly DueWindow[];
  /** YYYY-MM-DD, inclusive. Either may be empty. */
  readonly dueFrom: string;
  readonly dueTo: string;
  readonly words: string;
  readonly show: Show;
};

export const EMPTY_FILTER: WorkFilter = { projects: [], noProject: false, clients: [], who: [], labels: [], statuses: [], priorities: [], due: [], dueFrom: "", dueTo: "", words: "", show: "open" };

/** A row the filter looks at: the parts of a task it can choose by. */
export type WorkRowFacts = {
  readonly projectId: Id | null;
  readonly organizationId: Id | null;
  readonly assigneeId: Id | null;
  readonly labelIds: readonly Id[];
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly dueOn: string | null;
  readonly title: string;
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WORDS_MAX = 100;

/** The address's values for one name, as `URLSearchParams.getAll` gives them. */
export type Params = (name: string) => readonly string[];

const ids = (values: readonly string[]): Id[] => [...new Set(values.filter((value) => ID.test(value)))] as Id[];
const oneOf = <T extends string>(allowed: readonly T[], values: readonly string[]): T[] => [...new Set(values.filter((value): value is T => (allowed as readonly string[]).includes(value)))];

/** Reads a filter from the address. Anything it doesn't recognise is left out, never an error. */
export function readFilter(params: Params): WorkFilter {
  const projectValues = params("project");
  const first = (name: string) => params(name)[0] ?? "";
  const day = (name: string) => (DAY.test(first(name)) ? first(name) : "");
  const show = first("show");
  return {
    projects: ids(projectValues),
    noProject: projectValues.includes("none"),
    clients: ids(params("client")),
    who: [...new Set(params("who").filter((value) => value === "me" || value === "nobody" || ID.test(value)))] as WhoChoice[],
    labels: ids(params("label")),
    statuses: oneOf(TASK_STATUSES, params("status")),
    priorities: oneOf(TASK_PRIORITIES, params("priority")),
    due: oneOf(DUE_WINDOWS, params("due")),
    dueFrom: day("from"),
    dueTo: day("to"),
    words: first("q").trim().replace(/\s+/g, " ").slice(0, WORDS_MAX),
    show: (SHOW as readonly string[]).includes(show) ? (show as Show) : "open",
  };
}

/** The address for a filter, in a fixed order so the same filter is always the same link. Empty for no filter. */
export function filterQuery(filter: WorkFilter): string {
  const pairs: [string, string][] = [];
  for (const id of filter.projects) pairs.push(["project", id]);
  if (filter.noProject) pairs.push(["project", "none"]);
  for (const id of filter.clients) pairs.push(["client", id]);
  for (const who of filter.who) pairs.push(["who", who]);
  for (const id of filter.labels) pairs.push(["label", id]);
  for (const status of filter.statuses) pairs.push(["status", status]);
  for (const priority of filter.priorities) pairs.push(["priority", priority]);
  for (const due of filter.due) pairs.push(["due", due]);
  if (filter.dueFrom) pairs.push(["from", filter.dueFrom]);
  if (filter.dueTo) pairs.push(["to", filter.dueTo]);
  if (filter.words) pairs.push(["q", filter.words]);
  if (filter.show !== "open") pairs.push(["show", filter.show]);
  return new URLSearchParams(pairs).toString();
}

export const isEmptyFilter = (filter: WorkFilter): boolean => filterQuery(filter) === "";

/** Monday of the week `day` is in. */
function monday(day: string): Temporal.PlainDate {
  const date = Temporal.PlainDate.from(day);
  return date.subtract({ days: date.dayOfWeek - 1 });
}

/** Which window a due date is in, seen from `today`. */
export function dueWindow(dueOn: string | null, today: string): DueWindow {
  if (dueOn === null) return "none";
  if (dueOn < today) return "overdue";
  if (dueOn === today) return "today";
  const thisMonday = monday(today);
  const nextMonday = thisMonday.add({ weeks: 1 });
  const due = Temporal.PlainDate.from(dueOn);
  if (Temporal.PlainDate.compare(due, nextMonday) < 0) return "this-week";
  if (Temporal.PlainDate.compare(due, nextMonday.add({ weeks: 1 })) < 0) return "next-week";
  return "later";
}

/**
 * Whether a row passes. Within one field any choice may match (this label or
 * that one); across fields every field must (this label and this person).
 * "Overdue" never matches a finished task.
 */
export function matchesFilter(row: WorkRowFacts, filter: WorkFilter, context: { readonly today: string; readonly viewerId: Id }): boolean {
  const finished = row.status === "done";
  if (filter.show === "open" && finished) return false;
  if (filter.show === "done" && !finished) return false;
  if (filter.projects.length > 0 || filter.noProject) {
    const inProject = row.projectId !== null && filter.projects.includes(row.projectId);
    if (!inProject && !(filter.noProject && row.projectId === null)) return false;
  }
  if (filter.clients.length > 0 && (row.organizationId === null || !filter.clients.includes(row.organizationId))) return false;
  if (filter.who.length > 0) {
    const fits = filter.who.some((who) => (who === "nobody" ? row.assigneeId === null : who === "me" ? row.assigneeId === context.viewerId : row.assigneeId === who));
    if (!fits) return false;
  }
  if (filter.labels.length > 0 && !filter.labels.some((label) => row.labelIds.includes(label))) return false;
  if (filter.statuses.length > 0 && !filter.statuses.includes(row.status)) return false;
  if (filter.priorities.length > 0 && !filter.priorities.includes(row.priority)) return false;
  if (filter.due.length > 0) {
    const window = dueWindow(row.dueOn, context.today);
    const fits = filter.due.some((due) => (due === "overdue" ? window === "overdue" && !finished : due === window));
    if (!fits) return false;
  }
  if (filter.dueFrom && (row.dueOn === null || row.dueOn < filter.dueFrom)) return false;
  if (filter.dueTo && (row.dueOn === null || row.dueOn > filter.dueTo)) return false;
  if (filter.words) {
    const title = row.title.toLocaleLowerCase("en");
    if (!filter.words.toLocaleLowerCase("en").split(" ").every((word) => title.includes(word))) return false;
  }
  return true;
}

/** The table's columns, in the order they show. */
export const WORK_COLUMNS = ["project", "client", "who", "status", "priority", "due", "labels", "estimate"] as const;
export type WorkColumn = (typeof WORK_COLUMNS)[number];
export const DEFAULT_WORK_COLUMNS: readonly WorkColumn[] = ["project", "who", "status", "priority", "due", "labels"];

/** A saved choice of columns: the known ones, in table order. Nothing saved means the default. */
export function readColumns(saved: string): WorkColumn[] {
  if (saved.trim() === "") return [...DEFAULT_WORK_COLUMNS];
  const chosen = saved.split(",").map((one) => one.trim());
  return WORK_COLUMNS.filter((column) => chosen.includes(column));
}

/** What the table can be sorted by: the title and every column. */
export const WORK_SORTS = ["title", ...WORK_COLUMNS] as const;
export type WorkSort = (typeof WORK_SORTS)[number];

/** What a sort compares, for one row. */
export type WorkSortFacts = {
  readonly title: string;
  readonly projectName: string;
  readonly clientName: string;
  readonly assigneeName: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly dueOn: string | null;
  readonly labelNames: readonly string[];
  readonly estimateMinutes: number | null;
};

const text = (a: string, b: string): number => {
  if (a === b) return 0;
  if (a === "") return 1;
  if (b === "") return -1;
  return a.localeCompare(b, "en", { sensitivity: "base" });
};

/**
 * Sorts rows by one column. Empty values (no date, nobody, no project) go
 * last whichever way it runs; ties fall back to the title. Priority and
 * status sort in their own order (urgent first; to do, working on, blocked,
 * done), not alphabetically.
 */
export function sortWork<T extends WorkSortFacts>(rows: readonly T[], by: WorkSort, direction: "asc" | "desc"): T[] {
  const flip = direction === "desc" ? -1 : 1;
  const compare = (a: T, b: T): number => {
    switch (by) {
      case "title":
        return flip * text(a.title, b.title);
      case "project":
        return a.projectName === "" || b.projectName === "" ? text(a.projectName, b.projectName) : flip * text(a.projectName, b.projectName);
      case "client":
        return a.clientName === "" || b.clientName === "" ? text(a.clientName, b.clientName) : flip * text(a.clientName, b.clientName);
      case "who":
        return a.assigneeName === "" || b.assigneeName === "" ? text(a.assigneeName, b.assigneeName) : flip * text(a.assigneeName, b.assigneeName);
      case "status":
        return flip * (TASK_STATUSES.indexOf(a.status) - TASK_STATUSES.indexOf(b.status));
      case "priority":
        return flip * (TASK_PRIORITIES.indexOf(b.priority) - TASK_PRIORITIES.indexOf(a.priority));
      case "due":
        return a.dueOn === null || b.dueOn === null ? text(a.dueOn ?? "", b.dueOn ?? "") : flip * text(a.dueOn, b.dueOn);
      case "labels":
        return text(a.labelNames.join(", "), b.labelNames.join(", ")) * (a.labelNames.length === 0 || b.labelNames.length === 0 ? 1 : flip);
      case "estimate":
        return a.estimateMinutes === null || b.estimateMinutes === null ? (a.estimateMinutes === null ? (b.estimateMinutes === null ? 0 : 1) : -1) : flip * (a.estimateMinutes - b.estimateMinutes);
    }
  };
  return [...rows].sort((a, b) => compare(a, b) || text(a.title, b.title));
}
