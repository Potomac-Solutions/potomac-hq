// Public entry for notes: what was said and agreed, kept on the client,
// opportunity or project it is about.
export { NOTE_RECORD_TYPES, type Note, type NoteError, type NoteRecordType } from "./domain/note.ts";
export { addNote, listNotes, type NotesDeps, type NotesView, type NoteStore } from "./application/notes.ts";
