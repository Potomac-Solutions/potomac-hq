import type { Todo } from "../domain/todo.ts";
import type { Id } from "../../shared/index.ts";

/** A to-do or a project task as My work lists it, with its project's name ("" for a to-do). */
export type TodoRow = Todo & { readonly projectName: string; /** "BDW-12", or "TODO-7" (decision 0008, section 1). */ readonly ref: string };

/**
 * To-dos are tasks without a project (decision 0007, section 1). The store
 * reads and writes the task table. The open and done lists include project
 * tasks; the panels on a client and an opportunity hold only to-dos.
 */
export type TodoStore = {
  insert(todo: Todo, at: string): void;
  update(todo: Todo, at: string): void;
  get(id: Id): TodoRow | null;
  /** Someone's open work, to-dos and tasks of active projects, by due day with undated ones last. */
  openFor(assigneeId: Id): TodoRow[];
  /** Everyone's open work, the same order. */
  allOpen(): TodoRow[];
  /** Someone's work done since this instant, newest first. */
  doneSince(assigneeId: Id, since: string): TodoRow[];
  /** A client's open to-dos, including those on its opportunities. */
  openAtClient(organizationId: Id): TodoRow[];
  openOnOpportunity(opportunityId: Id): TodoRow[];
};

/** What the CRM knows that a to-do needs: a client's name, and an opportunity's client and title. */
export type CrmLookups = {
  readonly clientName: (organizationId: Id) => string | null;
  readonly opportunity: (opportunityId: Id) => { readonly organizationId: Id; readonly title: string } | null;
  readonly clients: () => readonly { readonly id: Id; readonly name: string }[];
};

/** A label as a line shows it. */
export type TodoLabel = { readonly id: string; readonly name: string; readonly colour: string };
