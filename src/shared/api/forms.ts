// Post, redirect, get. Every form in HQ works the same way: read the fields,
// call one application service, and send the browser to a page with a
// one-line message the server signed. This file imports no web framework, so
// it can be exported through src/shared/index.ts.
import { parseId, type Id } from "../application/ids.ts";

/** What a form sent: its text fields and any files. */
export type FormFields = Readonly<Record<string, string>>;
export type UploadedFile = { readonly name: string; readonly bytes: Uint8Array };
export type FormFiles = Readonly<Record<string, UploadedFile>>;

export type FormAnswer = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string };

/** The part of a request context a form post needs. Hono's context fits. */
type PostContext = {
  req: {
    parseBody(): Promise<Record<string, unknown>>;
    param(name: string): string | undefined;
    header(name: string): string | undefined;
  };
  redirect(location: string, status: 303): Response;
};

type PostApp = { post(path: string, handler: (c: never) => Promise<Response>): unknown };

export type FormPostDeps<A = Id | null> = {
  /** Who the request is from: the signed-in HQ user's id, or in the portal the client's session. Null when nobody. */
  readonly actorOf: (cookieHeader: string) => A;
  /** Signs the one-line message in a location. */
  readonly sign: (location: string) => string;
  readonly messageFor: (code: string) => string;
  /** Where a post about a record that does not exist is sent. */
  readonly home: string;
};

export type Places<V> = {
  /** Where to go when it worked. */
  readonly done: (value: V, id: Id | null, form: FormFields) => string;
  /** Where to go when it was refused. */
  readonly back: (id: Id | null, form: FormFields) => string;
  /** What to say when it worked; a function to say something about what happened. */
  readonly message: string | ((value: V) => string);
  /** The post that puts it back, offered as an Undo button and Ctrl+Z (decision 0014). Null when it can't be undone. */
  readonly undo?: (value: V, id: Id | null, form: FormFields) => Undo | null;
};

/** A form post that reverses one that just worked. Runs through the same route and permission checks as any other post. */
export type Undo = { readonly action: string; readonly fields: Readonly<Record<string, string>> };

const UNDO_ACTION = /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/;

/** Adds the signed `undo` to a location. Leaves it alone when there's nothing to undo or it wouldn't fit. */
export function withUndo(location: string, undo: Undo | null | undefined): string {
  if (!undo || !UNDO_ACTION.test(undo.action)) return location;
  const value = `${undo.action}?${new URLSearchParams(undo.fields as Record<string, string>).toString()}`;
  // Notices are cut at 200 characters; a cut undo would post the wrong thing.
  if (value.length > 200) return location;
  const [path = "", hash = ""] = location.split("#");
  const joined = `${path}${path.includes("?") ? "&" : "?"}undo=${encodeURIComponent(value)}`;
  return hash ? `${joined}#${hash}` : joined;
}

/** Reads a signed `undo` back into a form to show. Null for anything that isn't a plain HQ post. */
export function readUndo(value: string): { readonly action: string; readonly fields: readonly { readonly name: string; readonly value: string }[] } | null {
  if (!value) return null;
  const at = value.indexOf("?");
  const action = at === -1 ? value : value.slice(0, at);
  if (!UNDO_ACTION.test(action)) return null;
  const fields = [...new URLSearchParams(at === -1 ? "" : value.slice(at + 1))].map(([name, field]) => ({ name, value: field }));
  return { action, fields };
}

/** Adds `name=value` to a location that may already have a query. */
export function withMessage(location: string, name: "done" | "problem", message: string): string {
  const [path = "", hash = ""] = location.split("#");
  const joined = `${path}${path.includes("?") ? "&" : "?"}${name}=${encodeURIComponent(message)}`;
  return hash ? `${joined}#${hash}` : joined;
}

export async function readForm(c: PostContext): Promise<{ fields: Record<string, string>; files: Record<string, UploadedFile> }> {
  const raw = await c.req.parseBody();
  const fields: Record<string, string> = {};
  const files: Record<string, UploadedFile> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") fields[key] = value;
    else if (isFile(value) && value.size > 0) files[key] = { name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) };
  }
  return { fields, files };
}

function isFile(value: unknown): value is { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> } {
  return typeof value === "object" && value !== null && typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function" && typeof (value as { name?: unknown }).name === "string";
}

/**
 * Returns `post(path, run, places)`. `run` is given the actor, the form's
 * fields, the `:id` from the address (already checked to be an id) and any
 * uploaded files.
 */
export function formPosts<A = Id | null>(app: PostApp, deps: FormPostDeps<A>) {
  return function post<V>(
    path: string,
    run: (actor: A, form: FormFields, id: Id | null, files: FormFiles) => ({ ok: true; value: V } | { ok: false; error: string }) | Promise<{ ok: true; value: V } | { ok: false; error: string }>,
    places: Places<V>,
  ): void {
    app.post(path, (async (c: PostContext) => {
      const { fields, files } = await readForm(c);
      const param = c.req.param("id");
      const parsed = param === undefined ? null : parseId(param);
      const id = parsed === null ? null : parsed.ok ? parsed.value : null;
      if (param !== undefined && id === null) return c.redirect(deps.sign(withMessage(deps.home, "problem", deps.messageFor("not-found"))), 303);
      const answer = await run(deps.actorOf(c.req.header("cookie") ?? ""), fields, id, files);
      const to = answer.ok
        ? withUndo(withMessage(places.done(answer.value, id, fields), "done", typeof places.message === "function" ? places.message(answer.value) : places.message), places.undo?.(answer.value, id, fields))
        : withMessage(answer.error === "not-found" ? deps.home : places.back(id, fields), "problem", deps.messageFor(answer.error));
      return c.redirect(deps.sign(to), 303);
    }) as never);
  };
}
