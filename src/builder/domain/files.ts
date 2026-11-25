// A site in the builder is a set of text files: path to contents. These are
// the rules on what Claude may write (decision 0010, section 2). An answer
// that breaks one is refused whole, so a version is never half written.
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type SiteFiles = Readonly<Record<string, string>>;

/** Kinds of file a static site is made of, and what each is served as in the preview. */
export const FILE_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
};

export const MAX_FILES = 60;
/** Characters of text in one version, all files together. */
export const MAX_SITE_CHARS = 400_000;
const MAX_PATH = 120;

export type FileError = "path-invalid" | "type-not-allowed" | "too-many-files" | "site-too-large" | "no-home-page";

const extensionOf = (path: string): string => /\.([a-z0-9]+)$/.exec(path.toLowerCase())?.[1] ?? "";

/** What a file is served as, or null for a kind the builder doesn't make. */
export function contentTypeOf(path: string): string | null {
  return FILE_TYPES[extensionOf(path)] ?? null;
}

/**
 * A relative path inside the site: letters, digits, `-`, `_`, `.` and `/`
 * between parts; no part that is empty, `.` or `..`, and no leading dot on a
 * part (no `.env`, no `.git/`). Nothing Claude writes can leave the build.
 */
export function checkPath(path: string): Result<string, FileError> {
  if (path.length === 0 || path.length > MAX_PATH) return err("path-invalid");
  if (!/^[A-Za-z0-9._/-]+$/.test(path)) return err("path-invalid");
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part.startsWith("."))) return err("path-invalid");
  if (contentTypeOf(path) === null) return err("type-not-allowed");
  return ok(path);
}

export const totalChars = (files: SiteFiles): number => Object.values(files).reduce((sum, text) => sum + text.length, 0);

/** Checks a whole version: every path, the count, the size, and that there is a home page. */
export function checkSite(files: SiteFiles): Result<SiteFiles, FileError> {
  const paths = Object.keys(files);
  for (const path of paths) {
    const checked = checkPath(path);
    if (!checked.ok) return checked;
  }
  if (paths.length > MAX_FILES) return err("too-many-files");
  if (totalChars(files) > MAX_SITE_CHARS) return err("site-too-large");
  if (paths.length > 0 && files["index.html"] === undefined) return err("no-home-page");
  return ok(files);
}

export type FileChange = {
  readonly write: readonly { readonly path: string; readonly content: string }[];
  readonly remove: readonly string[];
};

/** The next version: these writes and removals on top of the last one. Sorted by path. */
export function applyChange(files: SiteFiles, change: FileChange): Result<SiteFiles, FileError> {
  const next: Record<string, string> = { ...files };
  for (const path of change.remove) {
    const checked = checkPath(path);
    if (!checked.ok) return checked;
    delete next[path];
  }
  for (const one of change.write) {
    const checked = checkPath(one.path);
    if (!checked.ok) return checked;
    next[one.path] = one.content;
  }
  const sorted = Object.fromEntries(Object.keys(next).sort().map((path) => [path, next[path] as string]));
  return checkSite(sorted);
}

/**
 * The file a preview address asks for: "" and folders mean their
 * index.html. null when the site has no such file.
 */
export function fileAt(files: SiteFiles, asked: string): { readonly path: string; readonly content: string; readonly type: string } | null {
  const path = asked === "" || asked.endsWith("/") ? `${asked}index.html` : asked;
  if (!checkPath(path).ok) return null;
  const content = files[path];
  const type = contentTypeOf(path);
  return content === undefined || type === null ? null : { path, content, type };
}

/** The files as one JSON text, for the database, and back. A stored text that isn't a site reads as no files. */
export const filesToJson = (files: SiteFiles): string => JSON.stringify(files);
export function filesFromJson(text: string): SiteFiles {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}
