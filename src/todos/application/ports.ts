import type { Todo } from "../domain/todo.ts";
import type { Id } from "../../shared/index.ts";

export type TodoStore = {
  insert(todo: Todo, at: string): void;
  update(todo: Todo, at: string): void;
  get(id: Id): Todo | null;
  /** Someone's open to-dos, by due day with undated ones last. */
  openFor(assigneeId: Id): Todo[];
  /** Everyone's open to-dos, the same order. */
  allOpen(): Todo[];
  /** Someone's to-dos done since this instant, newest first. */
  doneSince(assigneeId: Id, since: string): Todo[];
  /** A client's open to-dos, including those on its opportunities. */
  openAtClient(organizationId: Id): Todo[];
  openOnOpportunity(opportunityId: Id): Todo[];
};

/** What the CRM knows that a to-do needs: a client's name, and an opportunity's client and title. */
export type CrmLookups = {
  readonly clientName: (organizationId: Id) => string | null;
  readonly opportunity: (opportunityId: Id) => { readonly organizationId: Id; readonly title: string } | null;
  readonly clients: () => readonly { readonly id: Id; readonly name: string }[];
};
