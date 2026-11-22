// Notes: add one, and read a record's. Both need the permission to see the
// record itself, on top of the note permission.
import { isNoteRecordType, newNote, RECORD_VIEW_PERMISSION, type Note, type NoteError, type NoteRecordType } from "../domain/note.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";

export type NoteStore = {
  insert(note: Note): void;
  /** A record's notes, newest first, with each author's name. */
  listFor(recordType: NoteRecordType, recordId: Id): (Note & { readonly authorName: string })[];
  /** Whether the record a note would be on exists. */
  recordExists(recordType: NoteRecordType, recordId: Id): boolean;
};

export type NotesDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly notes: NoteStore;
  /** Formats a UTC instant for people, in the business time zone. */
  readonly formatWhen: (instant: string) => string;
};

const may = (deps: NotesDeps, actorId: Id | null, action: string): boolean => actorId !== null && authorize(deps, actorId, action).ok;

export function addNote(deps: NotesDeps, actorId: Id | null, input: { readonly recordType: string; readonly recordId: Id; readonly body: string }): Result<Note, "forbidden" | "not-found" | NoteError> {
  if (actorId === null || !may(deps, actorId, "note.add")) return err("forbidden");
  if (!isNoteRecordType(input.recordType)) return err("invalid-record-type");
  if (!may(deps, actorId, RECORD_VIEW_PERMISSION[input.recordType])) return err("forbidden");
  const type = input.recordType;
  return deps.transact(() => {
    if (!deps.notes.recordExists(type, input.recordId)) return err("not-found");
    const note = newNote(deps.newId(), { ...input, authorId: actorId }, deps.clock());
    if (!note.ok) return note;
    deps.notes.insert(note.value);
    recordActivity(deps, {
      actorId,
      action: "note.added",
      recordType: "note",
      recordId: note.value.id,
      context: { on: type, recordId: input.recordId, ...(type === "project" ? { projectId: input.recordId } : {}) },
    });
    return ok(note.value);
  });
}

export type NotesView = {
  readonly recordType: string;
  readonly recordId: string;
  readonly canAdd: boolean;
  readonly items: readonly { readonly id: string; readonly body: string; readonly authorName: string; readonly when: string; readonly whenIso: string }[];
};

/** A record's notes. Someone who may not read notes gets an empty list they cannot add to. */
export function listNotes(deps: NotesDeps, actorId: Id | null, recordType: string, recordId: Id): NotesView {
  const allowed = isNoteRecordType(recordType) && may(deps, actorId, "note.view") && may(deps, actorId, RECORD_VIEW_PERMISSION[recordType]);
  if (!allowed) return { recordType, recordId, canAdd: false, items: [] };
  return {
    recordType,
    recordId,
    canAdd: may(deps, actorId, "note.add"),
    items: deps.notes.listFor(recordType, recordId).map((note) => ({ id: note.id, body: note.body, authorName: note.authorName, when: deps.formatWhen(note.createdAt), whenIso: note.createdAt })),
  };
}
