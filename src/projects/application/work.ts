// The work table (decision 0007, section 3): every task you may see, from
// any project or none, filtered by fields, sorted by any column, with the
// columns each person chooses, saved filters, and a CSV download.
import { LABEL_COLOURS, type Label } from "../domain/label.ts";
import { options, PRIORITY_LABELS, TASK_STATUS_LABELS } from "../domain/labels.ts";
import { mayChange, mayUse, newSavedFilter, type SavedFilter, type SavedFilterError } from "../domain/saved-filter.ts";
import { formatHours, isTaskOverdue } from "../domain/task.ts";
import { DUE_WINDOWS, filterQuery, isEmptyFilter, matchesFilter, readColumns, readFilter, SHOW, sortWork, WORK_COLUMNS, WORK_SORTS, type Params, type WorkColumn, type WorkSort } from "../domain/work-filter.ts";
import { authorize } from "../../identity/index.ts";
import { dueText, err, ok, recordActivity, toCsv, type Id, type Result } from "../../shared/index.ts";
import type { ProjectsDeps, Refused } from "./commands.ts";
import type { WorkRow } from "./ports.ts";

type Option = { readonly value: string; readonly label: string };
type Choice = Option & { readonly on: boolean };

const may = (deps: ProjectsDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;
const canSee = (deps: ProjectsDeps, actorId: Id | null): actorId is Id => may(deps, actorId, "task.view") && may(deps, actorId, "project.view");

export const COLUMN_NAMES: Readonly<Record<WorkColumn | "title", string>> = {
  title: "Task",
  project: "Project",
  client: "Client",
  who: "Who",
  status: "Status",
  priority: "Priority",
  due: "Due",
  labels: "Labels",
  estimate: "Estimate",
};
const DUE_NAMES: Readonly<Record<string, string>> = { overdue: "Overdue", today: "Today", "this-week": "This week", "next-week": "Next week", later: "Later", none: "No due date" };
const SHOW_NAMES: Readonly<Record<string, string>> = { open: "Open", done: "Finished", all: "Open and finished" };

type Filtered = { readonly rows: (WorkRow & { readonly labels: readonly Label[] })[]; readonly sort: WorkSort; readonly dir: "asc" | "desc" };

/** The rows a filter and a sort give, with their labels. */
function filtered(deps: ProjectsDeps, actorId: Id, params: Params): Filtered {
  const filter = readFilter(params);
  const today = deps.today();
  const all = deps.work.rows();
  const labels = deps.labels.forTasks(all.map((row) => row.id));
  const sortValue = params("sort")[0] ?? "";
  const sort = (WORK_SORTS as readonly string[]).includes(sortValue) ? (sortValue as WorkSort) : "due";
  const dir = params("dir")[0] === "desc" ? "desc" : "asc";
  const rows = all
    .map((row) => ({ ...row, labels: labels.get(row.id) ?? [] }))
    .filter((row) => matchesFilter({ ...row, labelIds: row.labels.map((label) => label.id) }, filter, { today, viewerId: actorId }));
  const sorted = sortWork(
    rows.map((row) => ({ ...row, labelNames: row.labels.map((label) => label.name) })),
    sort,
    dir,
  );
  return { rows: sorted, sort, dir };
}

export type WorkCell = { readonly id: string; readonly href: string; readonly title: string; readonly projectId: string; readonly projectName: string; readonly clientName: string; readonly who: string; readonly status: string; readonly statusLabel: string; readonly priority: string; readonly priorityLabel: string; readonly pressing: boolean; readonly dueOn: string; readonly dueText: string; readonly overdue: boolean; readonly labels: readonly { readonly id: string; readonly name: string; readonly colour: string }[]; readonly estimate: string };

export type WorkView = {
  readonly form: {
    /** Whether this person may change tasks, so the table offers ticking several. */
    readonly canEdit: boolean;
    readonly projects: readonly Choice[];
    readonly clients: readonly Choice[];
    readonly people: readonly Choice[];
    readonly labels: readonly (Choice & { readonly colour: string })[];
    readonly statuses: readonly Choice[];
    readonly priorities: readonly Choice[];
    readonly due: readonly Choice[];
    readonly shows: readonly Choice[];
    readonly dueFrom: string;
    readonly dueTo: string;
    readonly words: string;
  };
  /** A filter is applied. */
  readonly filtering: boolean;
  /** The filter's address, without the sort. */
  readonly query: string;
  readonly headers: readonly { readonly key: string; readonly label: string; readonly href: string; readonly sorted: "ascending" | "descending" | "none" }[];
  readonly show: Readonly<Record<WorkColumn, boolean>>;
  readonly columns: readonly Choice[];
  readonly rows: readonly WorkCell[];
  readonly csvHref: string;
  readonly saved: readonly { readonly id: string; readonly name: string; readonly href: string; readonly shared: boolean; readonly pinned: boolean; readonly mine: boolean; readonly current: boolean; readonly owner: string }[];
  /** The saved filter this page shows exactly, if any. */
  readonly savedName: string;
};

/** The work table for one address. Permission: `task.view` and `project.view`. */
export function workTable(deps: ProjectsDeps, actorId: Id | null, params: Params): Result<WorkView, "forbidden"> {
  if (!canSee(deps, actorId)) return err("forbidden");
  const filter = readFilter(params);
  const query = filterQuery(filter);
  const { rows, sort, dir } = filtered(deps, actorId, params);
  const today = deps.today();
  const chosen = readColumns(deps.work.columns(actorId));
  const all = deps.work.rows();
  const on = <T extends string>(list: readonly T[], value: string) => (list as readonly string[]).includes(value);

  const projects = new Map<string, string>();
  const clients = new Map<string, string>();
  for (const row of all) {
    if (row.projectId) projects.set(row.projectId, row.projectName);
    if (row.organizationId && row.clientName) clients.set(row.organizationId, row.clientName);
  }
  const byName = (a: Option, b: Option) => a.label.localeCompare(b.label, "en", { sensitivity: "base" });
  const sortLink = (key: string) => {
    const next = sort === key && dir === "asc" ? "desc" : "asc";
    const params = new URLSearchParams(query);
    params.set("sort", key);
    params.set("dir", next);
    return `/work?${params.toString()}`;
  };
  const saved = deps.work
    .filtersFor(actorId)
    .filter((one) => mayUse(one, actorId))
    .map((one) => ({
      id: one.id,
      name: one.name,
      href: `/work?${one.query}`,
      shared: one.shared,
      pinned: one.pinned,
      mine: mayChange(one, actorId),
      current: one.query === query,
      owner: deps.users.get(one.ownerId)?.name ?? "",
    }));

  return ok({
    form: {
      canEdit: authorize(deps, actorId, "task.edit").ok,
      projects: [
        ...[...projects].map(([value, label]) => ({ value, label, on: on(filter.projects, value) })).sort(byName),
        { value: "none", label: "To-dos (no project)", on: filter.noProject },
      ],
      clients: [...clients].map(([value, label]) => ({ value, label, on: on(filter.clients, value) })).sort(byName),
      people: [
        { value: "me", label: "Me", on: on(filter.who, "me") },
        { value: "nobody", label: "Nobody yet", on: on(filter.who, "nobody") },
        ...deps.users
          .list()
          .filter((user) => user.status === "active" && user.id !== actorId)
          .map((user) => ({ value: user.id, label: user.name, on: on(filter.who, user.id) })),
      ],
      labels: deps.labels.list().map((label) => ({ value: label.id, label: label.name, colour: label.colour, on: on(filter.labels, label.id) })),
      statuses: options(TASK_STATUS_LABELS).map((one) => ({ ...one, on: on(filter.statuses, one.value) })),
      priorities: options(PRIORITY_LABELS)
        .reverse()
        .map((one) => ({ ...one, on: on(filter.priorities, one.value) })),
      due: DUE_WINDOWS.map((value) => ({ value, label: DUE_NAMES[value] ?? value, on: on(filter.due, value) })),
      shows: SHOW.map((value) => ({ value, label: SHOW_NAMES[value] ?? value, on: filter.show === value })),
      dueFrom: filter.dueFrom,
      dueTo: filter.dueTo,
      words: filter.words,
    },
    filtering: !isEmptyFilter(filter),
    query,
    headers: ["title", ...chosen].map((key) => ({ key, label: COLUMN_NAMES[key as WorkColumn] ?? key, href: sortLink(key), sorted: sort === key ? (dir === "asc" ? "ascending" : "descending") : "none" })),
    show: Object.fromEntries(WORK_COLUMNS.map((column) => [column, chosen.includes(column)])) as Record<WorkColumn, boolean>,
    columns: WORK_COLUMNS.map((column) => ({ value: column, label: COLUMN_NAMES[column], on: chosen.includes(column) })),
    rows: rows.map((row) => ({
      id: row.id,
      href: `/tasks/${row.id}`,
      title: row.title,
      projectId: row.projectId ?? "",
      projectName: row.projectName,
      clientName: row.clientName,
      who: row.assigneeName,
      status: row.status,
      statusLabel: TASK_STATUS_LABELS[row.status] ?? row.status,
      priority: row.priority,
      priorityLabel: PRIORITY_LABELS[row.priority] ?? row.priority,
      pressing: row.priority === "high" || row.priority === "urgent",
      dueOn: row.dueOn ?? "",
      dueText: row.dueOn ? dueText(row.dueOn, today) : "",
      overdue: isTaskOverdue(row, today),
      labels: row.labels.map((label) => ({ id: label.id, name: label.name, colour: LABEL_COLOURS.includes(label.colour) ? label.colour : "slate" })),
      estimate: row.estimateMinutes === null ? "" : formatHours(row.estimateMinutes),
    })),
    csvHref: `/work.csv${query ? `?${query}&` : "?"}sort=${sort}&dir=${dir}`,
    saved,
    savedName: saved.find((one) => one.current && query !== "")?.name ?? "",
  });
}

/** The same rows as a CSV file, every column. Permission: as the table. */
export function workCsv(deps: ProjectsDeps, actorId: Id | null, params: Params): Result<{ readonly csv: string; readonly fileName: string }, "forbidden"> {
  if (!canSee(deps, actorId)) return err("forbidden");
  const { rows } = filtered(deps, actorId, params);
  const csv = toCsv(
    ["Task", "Project", "Client", "Who", "Status", "Priority", "Due", "Labels", "Estimate (hours)"],
    rows.map((row) => [
      row.title,
      row.projectName,
      row.clientName,
      row.assigneeName,
      TASK_STATUS_LABELS[row.status] ?? row.status,
      PRIORITY_LABELS[row.priority] ?? row.priority,
      row.dueOn ?? "",
      row.labels.map((label) => label.name).join(", "),
      row.estimateMinutes === null ? "" : formatHours(row.estimateMinutes),
    ]),
  );
  return ok({ csv, fileName: `work-${deps.today()}.csv` });
}

/** The work page's address for a filter's query, read and written again so only filter fields are kept. */
export function workAddress(query: string): string {
  const tidy = filterQuery(readFilter((name) => new URLSearchParams(query).getAll(name)));
  return tidy ? `/work?${tidy}` : "/work";
}

/** The pinned saved filters for someone's sidebar. Empty without permission. */
export function pinnedFilters(deps: ProjectsDeps, actorId: Id | null): readonly { readonly name: string; readonly href: string }[] {
  if (!canSee(deps, actorId)) return [];
  return deps.work
    .filtersFor(actorId)
    .filter((one) => one.pinned && mayChange(one, actorId))
    .map((one) => ({ name: one.name, href: `/work?${one.query}` }));
}

// Changes. Each checks permission and writes its event in one transaction.

export function saveFilter(deps: ProjectsDeps, actorId: Id | null, input: { readonly name: string; readonly query: string; readonly shared?: boolean; readonly pinned?: boolean }): Result<SavedFilter, Refused | SavedFilterError> {
  if (!canSee(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const made = newSavedFilter(deps.newId(), actorId, input);
    if (!made.ok) return made;
    deps.work.insertFilter(made.value, deps.clock());
    recordActivity(deps, { actorId, action: "filter.saved", recordType: "saved-filter", recordId: made.value.id, context: { name: made.value.name, shared: made.value.shared, pinned: made.value.pinned } });
    return ok(made.value);
  });
}

/** Pins or unpins, shares or stops sharing. Only its owner may. */
export function changeSavedFilter(deps: ProjectsDeps, actorId: Id | null, id: Id, change: { readonly pinned?: boolean; readonly shared?: boolean }): Result<SavedFilter, Refused | "unchanged"> {
  if (!canSee(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const found = deps.work.getFilter(id);
    if (!found || !mayUse(found, actorId)) return err("not-found");
    if (!mayChange(found, actorId)) return err("forbidden");
    const next = { ...found, pinned: change.pinned ?? found.pinned, shared: change.shared ?? found.shared };
    if (next.pinned === found.pinned && next.shared === found.shared) return err("unchanged");
    deps.work.updateFilter(next, deps.clock());
    recordActivity(deps, { actorId, action: "filter.changed", recordType: "saved-filter", recordId: id, context: { name: next.name, shared: next.shared, pinned: next.pinned } });
    return ok(next);
  });
}

export function removeSavedFilter(deps: ProjectsDeps, actorId: Id | null, id: Id): Result<SavedFilter, Refused> {
  if (!canSee(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const found = deps.work.getFilter(id);
    if (!found || !mayUse(found, actorId)) return err("not-found");
    if (!mayChange(found, actorId)) return err("forbidden");
    deps.work.removeFilter(id);
    recordActivity(deps, { actorId, action: "filter.removed", recordType: "saved-filter", recordId: id, context: { name: found.name } });
    return ok(found);
  });
}

/** Someone's choice of columns. Unknown names are left out; choosing none keeps just the task's name. */
export function chooseWorkColumns(deps: ProjectsDeps, actorId: Id | null, chosen: readonly string[]): Result<readonly WorkColumn[], Refused | "unchanged"> {
  if (!canSee(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const columns = WORK_COLUMNS.filter((column) => chosen.includes(column));
    const before = readColumns(deps.work.columns(actorId));
    if (before.join(",") === columns.join(",")) return err("unchanged");
    // An empty choice is stored as a lone comma, so it isn't read back as "the default".
    deps.work.setColumns(actorId, columns.length === 0 ? "," : columns.join(","), deps.clock());
    recordActivity(deps, { actorId, action: "work.columns-chosen", recordType: "user", recordId: actorId, context: { columns } });
    return ok(columns);
  });
}
