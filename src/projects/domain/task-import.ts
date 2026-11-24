// Importing tasks from Trello and Todoist (decision 0007, section 13): their
// exports read into a plan of what would be made, shown before anything is.
//
// Trello, a board's JSON export: open cards in open lists become tasks; the
// list's name gives the status ("to do" when it names none); labels carry
// over, in the nearest of HQ's colours to Trello's; checklists become subtasks;
// due dates come across, and a card marked complete is done.
//
// Todoist, a project's CSV export: tasks become tasks, sections give the
// status as lists do, "@label" words in a task become labels, indented tasks
// become subtasks of the task above, notes go into the task's details, and
// the date column is read like quick add, repeats included. Priority 1 is
// Todoist's highest.
import { labelKey, type LabelColour } from "./label.ts";
import { parseQuickAdd } from "./quick-add.ts";
import type { Repeat } from "./repeat.ts";
import type { TaskPriority, TaskStatus } from "./task.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const IMPORT_SOURCES = ["trello", "todoist"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/** At most this many tasks, subtasks included, in one import. */
export const IMPORT_MAX_TASKS = 1000;

export type PlannedSubtask = { readonly title: string; readonly done: boolean; readonly dueOn: string | null };

export type PlannedTask = {
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly dueOn: string | null;
  readonly labels: readonly string[];
  readonly repeat: Repeat | null;
  readonly subtasks: readonly PlannedSubtask[];
  /** Where it came from: its list or section. */
  readonly from: string;
};

export type ImportPlan = {
  readonly source: ImportSource;
  /** The board's or project's name, when the export says. */
  readonly name: string;
  readonly tasks: readonly PlannedTask[];
  readonly labels: readonly { readonly name: string; readonly colour: LabelColour | null }[];
  /** Things left out, in words: "3 archived cards". */
  readonly skipped: readonly string[];
  /** Things read with a guess, in words. */
  readonly notes: readonly string[];
};

export type ImportError = "file-empty" | "not-trello" | "not-todoist" | "nothing-to-import" | "too-many-tasks";

/** A list's or section's name as a status. */
export function statusFromName(name: string): TaskStatus {
  const words = name.toLowerCase();
  if (/\b(done|complete|completed|finished|shipped|launched)\b/.test(words)) return "done";
  if (/\b(blocked|waiting|on hold|stuck)\b/.test(words)) return "blocked";
  if (/\b(doing|in progress|working|wip|in review|review|underway)\b/.test(words)) return "doing";
  return "todo";
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const titleOf = (text: string) => clip(text.replace(/\s+/g, " ").trim(), 200);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** An instant or a date, as the day it falls on in the business time zone. */
function dayOf(value: unknown, zone: string): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Temporal.PlainDate.from(value).toString();
    return Temporal.Instant.from(value).toZonedDateTimeISO(zone).toPlainDate().toString();
  } catch {
    return null;
  }
}

function finish(source: ImportSource, name: string, tasks: PlannedTask[], colours: Map<string, LabelColour | null>, skipped: string[], notes: string[]): Result<ImportPlan, ImportError> {
  if (tasks.length === 0) return err("nothing-to-import");
  const count = tasks.reduce((sum, task) => sum + 1 + task.subtasks.length, 0);
  if (count > IMPORT_MAX_TASKS) return err("too-many-tasks");
  const labels = [...colours].map(([labelName, colour]) => ({ name: labelName, colour })).sort((a, b) => a.name.localeCompare(b.name));
  return ok({ source, name, tasks, labels, skipped, notes });
}

/** Trello's label colours, as HQ's nearest. */
const TRELLO_COLOURS: Readonly<Record<string, LabelColour>> = { green: "green", yellow: "amber", orange: "orange", red: "red", purple: "violet", blue: "blue", sky: "sky", lime: "green", pink: "pink", black: "slate" };

const asList = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((one): one is Record<string, unknown> => typeof one === "object" && one !== null) : []);
const str = (value: unknown) => (typeof value === "string" ? value : "");

/** A Trello board's JSON export. */
export function readTrello(text: string, zone: string): Result<ImportPlan, ImportError> {
  if (text.trim() === "") return err("file-empty");
  let board: Record<string, unknown>;
  try {
    board = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return err("not-trello");
  }
  if (typeof board !== "object" || board === null || !Array.isArray(board["cards"]) || !Array.isArray(board["lists"])) return err("not-trello");
  const lists = new Map(asList(board["lists"]).map((list) => [str(list["id"]), { name: str(list["name"]), closed: list["closed"] === true }]));
  const labelsById = new Map(
    asList(board["labels"]).map((label) => {
      const colour = str(label["color"]).replace(/_(light|dark)$/, "");
      const name = str(label["name"]).trim() || (colour ? colour[0]?.toUpperCase() + colour.slice(1) : "");
      return [str(label["id"]), { name, colour: TRELLO_COLOURS[colour] ?? null }];
    }),
  );
  const checklists = new Map<string, Record<string, unknown>[]>();
  for (const list of asList(board["checklists"])) checklists.set(str(list["idCard"]), [...(checklists.get(str(list["idCard"])) ?? []), list]);
  const colours = new Map<string, LabelColour | null>();
  const tasks: PlannedTask[] = [];
  let archived = 0;
  let inArchivedLists = 0;
  for (const card of asList(board["cards"])) {
    const list = lists.get(str(card["idList"]));
    if (card["closed"] === true) {
      archived += 1;
      continue;
    }
    if (list?.closed) {
      inArchivedLists += 1;
      continue;
    }
    const title = titleOf(str(card["name"]));
    if (title === "") continue;
    const labels: string[] = [];
    for (const id of Array.isArray(card["idLabels"]) ? card["idLabels"] : []) {
      const label = labelsById.get(String(id));
      if (!label || label.name === "") continue;
      if (!labels.some((one) => labelKey(one) === labelKey(label.name))) labels.push(label.name);
      if (![...colours.keys()].some((one) => labelKey(one) === labelKey(label.name))) colours.set(label.name, label.colour);
    }
    const subtasks = (checklists.get(str(card["id"])) ?? []).flatMap((checklist) =>
      asList(checklist["checkItems"])
        .map((item) => ({ title: titleOf(str(item["name"])), done: item["state"] === "complete", dueOn: dayOf(item["due"], zone) }))
        .filter((item) => item.title !== ""),
    );
    const listName = list?.name ?? "";
    tasks.push({
      title,
      description: clip(str(card["desc"]).trim(), 5000),
      status: card["dueComplete"] === true ? "done" : statusFromName(listName),
      priority: "normal",
      dueOn: dayOf(card["due"], zone),
      labels,
      repeat: null,
      subtasks,
      from: listName || "No list",
    });
  }
  const skipped = [archived > 0 ? `${plural(archived, "archived card")}` : "", inArchivedLists > 0 ? `${plural(inArchivedLists, "card")} in archived lists` : ""].filter(Boolean);
  return finish("trello", titleOf(str(board["name"])), tasks, colours, skipped, []);
}

/** Reads CSV text: commas, quoted fields with doubled quotes, any line ending. */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const body = text.replace(/^﻿/, "");
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i] as string;
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && body[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((one) => one.some((cell) => cell.trim() !== ""));
}

const TODOIST_PRIORITY: Readonly<Record<string, TaskPriority>> = { "1": "urgent", "2": "high", "3": "normal", "4": "low" };

/** A Todoist project's CSV export. `today` is YYYY-MM-DD, for dates like "tomorrow". */
export function readTodoist(text: string, today: string): Result<ImportPlan, ImportError> {
  if (text.trim() === "") return err("file-empty");
  const rows = readCsv(text);
  const header = (rows[0] ?? []).map((cell) => cell.trim().toUpperCase());
  const at = (name: string) => header.indexOf(name);
  if (at("TYPE") < 0 || at("CONTENT") < 0) return err("not-todoist");
  const cell = (row: readonly string[], name: string) => (at(name) >= 0 ? (row[at(name)] ?? "").trim() : "");
  const colours = new Map<string, LabelColour | null>();
  const tasks: { -readonly [K in keyof PlannedTask]: PlannedTask[K] }[] = [];
  const notes: string[] = [];
  let section = "";
  let unreadDates = 0;
  let deeper = 0;
  for (const row of rows.slice(1)) {
    const type = cell(row, "TYPE").toLowerCase();
    if (type === "section") {
      section = cell(row, "CONTENT");
      continue;
    }
    if (type === "note") {
      const last = tasks.at(-1);
      if (last && cell(row, "CONTENT")) last.description = clip(`${last.description}${last.description ? "\n\n" : ""}${cell(row, "CONTENT")}`, 5000);
      continue;
    }
    if (type !== "task") continue;
    // "@label" words are labels; the rest is the title.
    const content = cell(row, "CONTENT");
    const labels: string[] = [];
    const words = content.split(/\s+/).filter((word) => {
      const match = /^@([\p{L}\p{N}][\p{L}\p{N}_\-/]*)$/u.exec(word);
      if (!match) return true;
      const name = (match[1] as string).replace(/_/g, " ");
      if (!labels.some((one) => labelKey(one) === labelKey(name))) labels.push(name);
      if (![...colours.keys()].some((one) => labelKey(one) === labelKey(name))) colours.set(name, null);
      return false;
    });
    const title = titleOf(words.join(" "));
    if (title === "") continue;
    const date = cell(row, "DATE");
    const read = date ? parseQuickAdd(date, today) : null;
    const due = read?.parts.find((part) => part.kind === "due");
    const repeat = read?.parts.find((part) => part.kind === "repeat");
    if (date && !due && !repeat) unreadDates += 1;
    const indent = Number(cell(row, "INDENT") || "1");
    const parent = tasks.at(-1);
    if (indent > 1 && parent) {
      if (indent > 2) deeper += 1;
      parent.subtasks = [...parent.subtasks, { title, done: false, dueOn: due && due.kind === "due" ? due.on : null }];
      continue;
    }
    tasks.push({
      title,
      description: clip(cell(row, "DESCRIPTION"), 5000),
      status: statusFromName(section),
      priority: TODOIST_PRIORITY[cell(row, "PRIORITY")] ?? "normal",
      dueOn: due && due.kind === "due" ? due.on : null,
      labels,
      repeat: repeat && repeat.kind === "repeat" ? repeat.repeat : null,
      subtasks: [],
      from: section || "No section",
    });
  }
  if (unreadDates > 0) notes.push(`${plural(unreadDates, "date")} couldn't be read, so ${unreadDates === 1 ? "that task has" : "those tasks have"} none.`);
  if (deeper > 0) notes.push(`${plural(deeper, "task")} indented more than once became subtasks of the task above, as HQ's subtasks go one level deep.`);
  return finish("todoist", "", tasks, colours, [], notes);
}
