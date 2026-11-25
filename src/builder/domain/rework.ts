// Starting a build from a site that already exists (decision 0010, slice 3):
// a repository, read through GitHub, or a public address, read as text.
//
// A repository that is already a plain static site (an index.html at its
// top, in kinds of file the builder makes) becomes the build's first
// version as it is. Anything else (a React, Vue or Zubra project, or a live
// address) is read as reference: text Claude is shown with the first
// request, to rework into plain files. Its pictures become the build's.
import { err, ok, type Result } from "../../shared/domain/result.ts";
import { checkPath, MAX_FILES, MAX_SITE_CHARS, type SiteFiles } from "./files.ts";

export type RepoRef = { readonly owner: string; readonly name: string; readonly branch: string | null };
export type ReworkError = "source-invalid" | "repo-invalid" | "branch-invalid" | "address-invalid";

/** "owner/name", a GitHub address, or either with "#branch". */
export function parseRepo(text: string, branchText = ""): Result<RepoRef, ReworkError> {
  const trimmed = text.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(trimmed);
  if (!match || match[2] === "." || match[2] === "..") return err("repo-invalid");
  const branch = branchText.trim();
  if (branch && (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/"))) return err("branch-invalid");
  return ok({ owner: match[1] as string, name: match[2] as string, branch: branch || null });
}

/** An https address on the public web, without a sign-in in it. The address itself is checked again when it's read. */
export function parseAddress(text: string): Result<URL, ReworkError> {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text.trim()) ? text.trim() : `https://${text.trim()}`);
  } catch {
    return err("address-invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return err("address-invalid");
  url.hash = "";
  return ok(url);
}

export type TreeEntry = { readonly path: string; readonly size: number; readonly sha: string };

/** Folders that hold what a project is built from or into, never the site itself. */
const SKIP = /(^|\/)(node_modules|\.[^/]*|dist|build|out|coverage|vendor|\.next|\.nuxt|test|tests|__tests__|e2e)(\/|$)/;
const LOCK = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|tsconfig[^/]*\.json|\.eslintrc[^/]*)$/;
/** Text a project's site is made from, shown to Claude as reference. */
const SOURCE = /\.(html?|css|scss|js|mjs|jsx|ts|tsx|vue|svelte|astro|zb|md|json)$/i;
const PICTURE = /\.(jpe?g|png|webp)$/i;

export const MAX_REFERENCE_CHARS = 150_000;
const MAX_SOURCE_FILE = 40_000;
export const MAX_IMPORTED_IMAGES = 30;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export type RepoPlan =
  /** A static site: these files are the first version. */
  | { readonly kind: "static"; readonly files: readonly TreeEntry[]; readonly pictures: readonly TreeEntry[] }
  /** A project: these files are read as reference. */
  | { readonly kind: "reference"; readonly files: readonly TreeEntry[]; readonly pictures: readonly TreeEntry[] };

/** How much of a file to read first: the home page and the readme, then source, the shortest first. */
const rank = (path: string): number => (/^index\.html?$/i.test(path) ? 0 : /^readme\.md$/i.test(path) ? 1 : /^(src|app|pages|components|public)\//.test(path) ? 2 : 3);

/** Decides what to read from a repository's files. */
export function planRepo(entries: readonly TreeEntry[]): RepoPlan {
  const usable = entries.filter((one) => !SKIP.test(one.path) && !LOCK.test(one.path));
  const pictures = usable.filter((one) => PICTURE.test(one.path) && one.size <= MAX_IMAGE_BYTES && importedImagePath(one.path) !== null).slice(0, MAX_IMPORTED_IMAGES);
  const staticFiles = usable.filter((one) => checkPath(one.path).ok);
  const isStatic = staticFiles.some((one) => one.path === "index.html") && !usable.some((one) => /\.(jsx|tsx|vue|svelte|astro|zb)$/i.test(one.path) || one.path === "package.json");
  if (isStatic && staticFiles.length <= MAX_FILES && staticFiles.reduce((sum, one) => sum + one.size, 0) <= MAX_SITE_CHARS) return { kind: "static", files: staticFiles, pictures };
  const source = usable
    .filter((one) => SOURCE.test(one.path) && one.size <= MAX_SOURCE_FILE)
    .sort((a, b) => rank(a.path) - rank(b.path) || a.size - b.size);
  const chosen: TreeEntry[] = [];
  let total = 0;
  for (const one of source) {
    if (total + one.size > MAX_REFERENCE_CHARS) continue;
    chosen.push(one);
    total += one.size;
  }
  return { kind: "reference", files: chosen, pictures };
}

/** A picture's path from a repository kept as it was, so the old pages still show it; null if it isn't a safe one. */
export function importedImagePath(path: string): string | null {
  if (path.length > 160 || !/^[A-Za-z0-9._/-]+$/.test(path) || !PICTURE.test(path)) return null;
  if (path.split("/").some((part) => part === "" || part.startsWith("."))) return null;
  return path;
}

/** What a picture from an old site shows, until someone says better: from its file name. */
export const importedAlt = (path: string): string => `From the old site: ${(path.split("/").pop() ?? path).replace(/\.[a-z]+$/i, "").replace(/[-_]+/g, " ")}`;

/** Reference text: each file or page in a tag of its own, cut to the limit. */
export function referenceText(parts: readonly { readonly from: string; readonly text: string }[]): string {
  const out: string[] = [];
  let total = 0;
  for (const part of parts) {
    const room = MAX_REFERENCE_CHARS - total;
    if (room <= 200) break;
    const text = part.text.length > room ? `${part.text.slice(0, room)}\n[cut short]` : part.text;
    out.push(`<source from="${part.from.replace(/"/g, "")}">\n${text}\n</source>`);
    total += text.length;
  }
  return out.join("\n");
}

/** A page read from the web, without what Claude doesn't need: scripts, comments, inline SVG drawing, extra space. */
export function slimPage(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script>…</script>")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "<svg>…</svg>")
    .replace(/<(path|polygon|g)\b[^>]*\/?>/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .slice(0, MAX_SOURCE_FILE)
    .trim();
}

/** Other pages on the same site a home page links to, in order, at most `most`. */
export function sameSiteLinks(html: string, base: URL, most: number): URL[] {
  const found: URL[] = [];
  const seen = new Set([base.origin + base.pathname]);
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)/gi)) {
    let url: URL;
    try {
      url = new URL(match[1] as string, base);
    } catch {
      continue;
    }
    if (url.origin !== base.origin || /\.(pdf|jpe?g|png|webp|gif|zip|docx?|xlsx?)$/i.test(url.pathname)) continue;
    url.hash = "";
    url.search = "";
    const key = url.origin + url.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(url);
    if (found.length >= most) break;
  }
  return found;
}

/** A static repository's text files as a first version: those that decode as text. */
export function staticFiles(read: readonly { readonly path: string; readonly text: string | null }[]): SiteFiles {
  return Object.fromEntries(
    read
      .filter((one) => one.text !== null)
      .map((one): [string, string] => [one.path, one.text as string])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  );
}

export const FIRST_REWORK_ASK = "Rework this website: follow the brief, keep the business's real content and facts from the old site, and write it as plain static files.";
