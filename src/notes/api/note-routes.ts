// The one form that adds a note. Where the browser goes afterwards is worked
// out here from the kind of record, never taken from the form.
import { Hono } from "hono";
import { addNote, type NotesDeps } from "../application/notes.ts";
import { formPosts, parseId, type Id } from "../../shared/index.ts";

export type NoteRoutesDeps = {
  readonly notes: NotesDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
};

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That record doesn’t exist.",
  "note-empty": "Write the note first.",
  "note-too-long": "That note is too long.",
  "invalid-record-type": "Notes can’t be added there.",
};

const PAGES: Readonly<Record<string, string>> = { "client-organization": "/clients", opportunity: "/opportunities", project: "/projects" };

export function noteRoutes(deps: NoteRoutesDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor: (code) => MESSAGES[code] ?? "That didn’t work. Try again.", home: "/" });
  const page = (form: Readonly<Record<string, string>>) => {
    const base = PAGES[form["recordType"] ?? ""];
    const id = parseId(form["recordId"] ?? "");
    return base && id.ok ? `${base}/${id.value}#notes` : "/";
  };
  post(
    "/notes",
    (actor, form) => {
      const id = parseId(form["recordId"] ?? "");
      if (!id.ok) return { ok: false as const, error: "not-found" };
      return addNote(deps.notes, actor, { recordType: form["recordType"] ?? "", recordId: id.value, body: form["body"] ?? "" });
    },
    { done: (_note, _id, form) => page(form), back: (_id, form) => page(form), message: "Note added." },
  );
  return app;
}
