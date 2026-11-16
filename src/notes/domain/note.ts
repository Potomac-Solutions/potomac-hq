// A note on a client, an opportunity or a project: what was said on a call,
// what was agreed. Written once and never edited (docs/data-model.md, "Note").
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const NOTE_RECORD_TYPES = ["client-organization", "opportunity", "project"] as const;
export type NoteRecordType = (typeof NOTE_RECORD_TYPES)[number];

export type Note = {
  readonly id: Id;
  readonly recordType: NoteRecordType;
  readonly recordId: Id;
  readonly authorId: Id;
  readonly body: string;
  readonly createdAt: string;
};

export type NoteError = "note-empty" | "note-too-long" | "invalid-record-type";

export const isNoteRecordType = (value: string): value is NoteRecordType => (NOTE_RECORD_TYPES as readonly string[]).includes(value);

/** The permission needed to see the record a note is on. A note is never easier to read than its record. */
export const RECORD_VIEW_PERMISSION: { readonly [K in NoteRecordType]: string } = {
  "client-organization": "client.view",
  opportunity: "opportunity.view",
  project: "project.view",
};

export function newNote(id: Id, input: { readonly recordType: string; readonly recordId: Id; readonly authorId: Id; readonly body: string }, at: string): Result<Note, NoteError> {
  if (!isNoteRecordType(input.recordType)) return err("invalid-record-type");
  const body = input.body.trim();
  if (body.length === 0) return err("note-empty");
  if (body.length > 5000) return err("note-too-long");
  return ok({ id, recordType: input.recordType, recordId: input.recordId, authorId: input.authorId, body, createdAt: at });
}
