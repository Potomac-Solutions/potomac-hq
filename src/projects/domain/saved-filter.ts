// A saved filter: a work-table filter with a name (decision 0007, section 3).
// It is its owner's alone unless shared with everyone, and its owner may pin
// it to their sidebar.
import { requiredText } from "../../shared/domain/fields.ts";
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";
import { filterQuery, isEmptyFilter, readFilter } from "./work-filter.ts";

export type SavedFilter = {
  readonly id: Id;
  readonly ownerId: Id;
  readonly name: string;
  /** The filter's address, in the order `filterQuery` writes it. */
  readonly query: string;
  readonly shared: boolean;
  readonly pinned: boolean;
};

export type SavedFilterInput = { readonly name: string; readonly query: string; readonly shared?: boolean; readonly pinned?: boolean };
export type SavedFilterError = "name-missing" | "name-too-long" | "filter-empty";

export const SAVED_FILTER_NAME_MAX = 60;

/** Saves a filter. Its address is read and written again, so only real filter fields are kept. */
export function newSavedFilter(id: Id, ownerId: Id, input: SavedFilterInput): Result<SavedFilter, SavedFilterError> {
  const name = requiredText(input.name, SAVED_FILTER_NAME_MAX);
  if (!name.ok) return err(name.error === "missing" ? "name-missing" : "name-too-long");
  const filter = readFilter((field) => new URLSearchParams(input.query).getAll(field));
  if (isEmptyFilter(filter)) return err("filter-empty");
  return ok({ id, ownerId, name: name.value, query: filterQuery(filter), shared: input.shared === true, pinned: input.pinned === true });
}

/** Who may change or delete a saved filter: only the person who saved it. */
export const mayChange = (filter: SavedFilter, personId: Id): boolean => filter.ownerId === personId;

/** Who sees it: its owner, and everyone once it is shared. */
export const mayUse = (filter: SavedFilter, personId: Id): boolean => filter.shared || filter.ownerId === personId;
