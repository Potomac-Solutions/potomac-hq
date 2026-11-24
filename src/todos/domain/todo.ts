// A to-do: something for someone to do, by a day or whenever. It may be about
// a client, or one of a client's opportunities. Since decision 0007 a to-do is
// a task without a project, kept in the task table; My work lists both.
import type { Id } from "../../shared/domain/id.ts";
import { calendarDate, requiredText } from "../../shared/domain/fields.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type Todo = {
  readonly id: Id;
  readonly title: string;
  readonly dueOn: string | null;
  readonly assigneeId: Id;
  readonly organizationId: Id | null;
  readonly opportunityId: Id | null;
  /** When it was done, or null while it is open. */
  readonly doneAt: string | null;
  /** Who added it. Unknown for project tasks made before decision 0007. */
  readonly createdBy: Id | null;
  /** The project it belongs to, or null for a to-do. */
  readonly projectId: Id | null;
};

export type TodoInput = { readonly title: string; readonly dueOn?: string | null };
export type TodoError = "title-missing" | "title-too-long" | "invalid-date";

export function newTodo(ids: { readonly id: Id; readonly assigneeId: Id; readonly organizationId: Id | null; readonly opportunityId: Id | null; readonly createdBy: Id }, input: TodoInput): Result<Todo, TodoError> {
  const title = requiredText(input.title, 200);
  if (!title.ok) return err(title.error === "missing" ? "title-missing" : "title-too-long");
  const dueText = (input.dueOn ?? "").trim();
  const due = dueText ? calendarDate(dueText) : ok(null);
  if (!due.ok) return due;
  return ok({ ...ids, title: title.value, dueOn: due.value, doneAt: null, projectId: null });
}

/** Where an open to-do stands today. */
export type TodoState = "overdue" | "today" | "upcoming" | "someday";

export function stateOf(todo: Pick<Todo, "dueOn">, today: string): TodoState {
  if (todo.dueOn === null) return "someday";
  if (todo.dueOn < today) return "overdue";
  return todo.dueOn === today ? "today" : "upcoming";
}
