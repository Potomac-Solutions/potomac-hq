// To-dos: add one for yourself or anyone, by a day or whenever, at a client or
// on an opportunity; tick it off; see what is yours. Permissions: `task.view`
// to see and `task.edit` to add and tick off, the same as project tasks.
import { newTodo, stateOf, type Todo, type TodoError, type TodoInput, type TodoState } from "../domain/todo.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { dueText, err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { CrmLookups, TodoStore } from "./ports.ts";

export type TodosDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly todos: TodoStore;
  readonly crm: CrmLookups;
  readonly today: () => string;
};

type Refused = "forbidden" | "not-found";
const allowed = (deps: TodosDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;

export type AddTodoInput = TodoInput & { readonly assigneeId?: string | null; readonly clientId?: string | null; readonly opportunityId?: string | null };

/** Adds a to-do. With no one named it is the actor's. On an opportunity, it is at that opportunity's client. */
export function addTodo(deps: TodosDeps, actorId: Id | null, input: AddTodoInput): Result<Todo, Refused | TodoError | "assignee-not-found"> {
  if (!allowed(deps, actorId, "task.edit")) return err("forbidden");
  return deps.transact(() => {
    const assigneeId = ((input.assigneeId ?? "").trim() || actorId) as Id;
    if (deps.users.get(assigneeId)?.status !== "active") return err("assignee-not-found");
    const opportunityId = ((input.opportunityId ?? "").trim() || null) as Id | null;
    const opportunity = opportunityId ? deps.crm.opportunity(opportunityId) : null;
    if (opportunityId && !opportunity) return err("not-found");
    const organizationId = (opportunity?.organizationId ?? ((input.clientId ?? "").trim() || null)) as Id | null;
    if (organizationId && deps.crm.clientName(organizationId) === null) return err("not-found");
    const made = newTodo({ id: deps.newId(), assigneeId, organizationId, opportunityId, createdBy: actorId }, input);
    if (!made.ok) return made;
    deps.todos.insert(made.value, deps.clock());
    recordActivity(deps, { actorId, action: "todo.added", recordType: "todo", recordId: made.value.id, context: { assigneeId, ...(made.value.dueOn ? { dueOn: made.value.dueOn } : {}), ...(organizationId ? { clientId: organizationId } : {}) } });
    return ok(made.value);
  });
}

function setDone(deps: TodosDeps, actorId: Id | null, id: Id, done: boolean): Result<Todo, Refused> {
  if (!allowed(deps, actorId, "task.edit")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.todos.get(id);
    if (!found || (found.doneAt !== null) === done) return err("not-found");
    const next = { ...found, doneAt: done ? deps.clock() : null };
    deps.todos.update(next, deps.clock());
    recordActivity(deps, { actorId, action: done ? "todo.done" : "todo.reopened", recordType: "todo", recordId: id, context: { assigneeId: found.assigneeId } });
    return ok(next);
  });
}

/** Ticks it off. */
export const completeTodo = (deps: TodosDeps, actorId: Id | null, id: Id) => setDone(deps, actorId, id, true);
/** Not done after all. */
export const reopenTodo = (deps: TodosDeps, actorId: Id | null, id: Id) => setDone(deps, actorId, id, false);

export type TodoLine = {
  readonly id: string;
  readonly title: string;
  readonly dueOn: string;
  readonly when: string;
  readonly state: TodoState;
  readonly assignee: string;
  readonly mine: boolean;
  readonly organizationId: string;
  readonly clientName: string;
  readonly opportunityId: string;
  readonly opportunityTitle: string;
  readonly done: boolean;
};

function lineOf(deps: TodosDeps, actorId: Id, todo: Todo, today: string): TodoLine {
  const opportunity = todo.opportunityId ? deps.crm.opportunity(todo.opportunityId) : null;
  return {
    id: todo.id,
    title: todo.title,
    dueOn: todo.dueOn ?? "",
    when: todo.dueOn ? dueText(todo.dueOn, today) : "Whenever",
    state: stateOf(todo, today),
    assignee: deps.users.get(todo.assigneeId)?.name ?? "Someone",
    mine: todo.assigneeId === actorId,
    organizationId: todo.organizationId ?? "",
    clientName: todo.organizationId ? (deps.crm.clientName(todo.organizationId) ?? "") : "",
    opportunityId: todo.opportunityId ?? "",
    opportunityTitle: opportunity?.title ?? "",
    done: todo.doneAt !== null,
  };
}

type Option = { readonly value: string; readonly label: string };
const peopleOptions = (deps: TodosDeps, actorId: Id): readonly Option[] => [
  ...deps.users.list().filter((one) => one.id === actorId),
  ...deps.users.list().filter((one) => one.id !== actorId && one.status === "active"),
].map((one) => ({ value: one.id, label: one.id === actorId ? `Me (${one.name})` : one.name }));

export type TodosView = {
  readonly overdue: readonly TodoLine[];
  readonly today: readonly TodoLine[];
  readonly upcoming: readonly TodoLine[];
  readonly someday: readonly TodoLine[];
  /** Ticked off in the last week. */
  readonly done: readonly TodoLine[];
  readonly everyone: boolean;
  readonly canEdit: boolean;
  readonly people: readonly Option[];
  readonly clients: readonly Option[];
};

/** Your open to-dos, or everyone's, by when; and what you ticked off this week. Permission: `task.view`. */
export function listTodos(deps: TodosDeps, actorId: Id | null, options: { readonly everyone?: boolean } = {}): Result<TodosView, "forbidden"> {
  if (!allowed(deps, actorId, "task.view")) return err("forbidden");
  const today = deps.today();
  const everyone = options.everyone === true;
  const lines = (everyone ? deps.todos.allOpen() : deps.todos.openFor(actorId)).map((one) => lineOf(deps, actorId, one, today));
  const weekAgo = Temporal.Instant.from(deps.clock()).subtract({ hours: 24 * 7 }).toString();
  return ok({
    overdue: lines.filter((one) => one.state === "overdue"),
    today: lines.filter((one) => one.state === "today"),
    upcoming: lines.filter((one) => one.state === "upcoming"),
    someday: lines.filter((one) => one.state === "someday"),
    done: deps.todos.doneSince(actorId, weekAgo).map((one) => lineOf(deps, actorId, one, today)),
    everyone,
    canEdit: allowed(deps, actorId, "task.edit"),
    people: peopleOptions(deps, actorId),
    clients: deps.crm.clients().map((one) => ({ value: one.id, label: one.name })),
  });
}

/** Your open to-dos that are overdue or due today, for the Today page and the morning email. Empty without `task.view`. */
export function todosDueFor(deps: TodosDeps, actorId: Id | null): readonly TodoLine[] {
  if (!allowed(deps, actorId, "task.view")) return [];
  const today = deps.today();
  return deps.todos
    .openFor(actorId)
    .map((one) => lineOf(deps, actorId, one, today))
    .filter((one) => one.state === "overdue" || one.state === "today");
}

export type TodosPanel = { readonly items: readonly TodoLine[]; readonly canEdit: boolean; readonly people: readonly Option[] };

/** The open to-dos at a client (with those on its opportunities) or on one opportunity. Permission: `task.view`. */
export function todosAt(deps: TodosDeps, actorId: Id | null, where: { readonly clientId: Id } | { readonly opportunityId: Id }): Result<TodosPanel, "forbidden"> {
  if (!allowed(deps, actorId, "task.view")) return err("forbidden");
  const today = deps.today();
  const found = "clientId" in where ? deps.todos.openAtClient(where.clientId) : deps.todos.openOnOpportunity(where.opportunityId);
  return ok({ items: found.map((one) => lineOf(deps, actorId, one, today)), canEdit: allowed(deps, actorId, "task.edit"), people: peopleOptions(deps, actorId) });
}

/** Your to-dos ticked off since this instant, newest first. Empty without `task.view`. */
export function todosDoneSince(deps: TodosDeps, actorId: Id | null, since: string): readonly TodoLine[] {
  if (!allowed(deps, actorId, "task.view")) return [];
  const today = deps.today();
  return deps.todos.doneSince(actorId, since).map((one) => lineOf(deps, actorId, one, today));
}
