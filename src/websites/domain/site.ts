// A client's website that HQ can publish to: where its code lives, what is
// on it now, and any changes waiting to go on it.
import { requiredText } from "../../shared/domain/fields.ts";
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";
import { sameContent, type SiteContent } from "./content.ts";
import { cleanSiteAddress, type Launch } from "./launch.ts";
import type { ServiceArea } from "./service-area.ts";

/** Where the site's code lives on GitHub. */
export type Repo = { readonly owner: string; readonly name: string; readonly branch: string };

/**
 * none: nothing is waiting. editing: changes are being made and have not
 * been sent. submitted: the client sent them for Potomac to check.
 */
export type DraftState = "none" | "editing" | "submitted";

export type ContentSite = {
  readonly id: Id;
  readonly organizationId: Id;
  /** What the client calls it: "Nu Finish website". */
  readonly name: string;
  readonly repo: Repo;
  /** The content file in the repository, like src/content/site.json. */
  readonly contentPath: string;
  /** The folder new photos are put in, like public/gallery. */
  readonly photoDir: string;
  /** What is on the site, as of the last time HQ read or published it. */
  readonly published: SiteContent;
  readonly publishedAt: string | null;
  readonly publishedCommit: string | null;
  /** The content with the waiting changes made. Null when nothing is waiting. */
  readonly draft: SiteContent | null;
  readonly draftState: DraftState;
  readonly submittedAt: string | null;
  /** Who sent the changes in, by name. */
  readonly submittedBy: string | null;
  /** What Potomac wrote when sending changes back. */
  readonly note: string;
  /** The site's own address, like https://nufinishcollision.com. Empty until someone gives it. */
  readonly siteUrl: string;
  /** Whether the site is open to everyone, as last written to it. */
  readonly launch: Launch;
  /** The key in the site's preview link. Null until the site is first closed. */
  readonly previewKey: string | null;
  /** Where the business goes, as last written to the site. Null for a site with no service area. */
  readonly serviceArea: ServiceArea | null;
};

export type SetupError = "name-missing" | "name-too-long" | "repo-invalid" | "branch-invalid" | "content-path-invalid" | "photo-dir-invalid" | "address-invalid";
export type SetupInput = { readonly name: string; readonly repo: string; readonly branch?: string | null; readonly contentPath?: string | null; readonly photoDir?: string | null; readonly siteUrl?: string | null };

export const DEFAULTS = { branch: "main", contentPath: "src/content/site.json", photoDir: "public/gallery" } as const;

/** A path inside a repository: plain names between single slashes. Never a way out of it. */
const cleanPath = (typed: string): string | null => {
  const path = typed.trim().replace(/^\/+|\/+$/g, "");
  return path.length > 0 && path.length <= 150 && path.split("/").every((part) => /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(part) && !part.endsWith(".")) ? path : null;
};

/** "owner/name", or the repository's address on GitHub. */
export function cleanRepo(typed: string): Result<{ owner: string; name: string }, "repo-invalid"> {
  const text = typed.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9._-]{1,100})$/.exec(text);
  if (!match || match[2] === "." || match[2] === "..") return err("repo-invalid");
  return ok({ owner: match[1] as string, name: match[2] as string });
}

export type SiteSetup = Pick<ContentSite, "name" | "repo" | "contentPath" | "photoDir" | "siteUrl">;

export function siteSetup(input: SetupInput): Result<SiteSetup, SetupError> {
  const name = requiredText(input.name, 80);
  if (!name.ok) return err(name.error === "missing" ? "name-missing" : "name-too-long");
  const repo = cleanRepo(input.repo);
  if (!repo.ok) return repo;
  const branch = (input.branch ?? "").trim() || DEFAULTS.branch;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(branch) || branch.includes("..") || branch.includes("//") || branch.endsWith("/") || branch.endsWith(".lock")) return err("branch-invalid");
  const contentPath = cleanPath((input.contentPath ?? "").trim() || DEFAULTS.contentPath);
  if (!contentPath || !contentPath.endsWith(".json")) return err("content-path-invalid");
  const photoDir = cleanPath((input.photoDir ?? "").trim() || DEFAULTS.photoDir);
  if (!photoDir) return err("photo-dir-invalid");
  const siteUrl = cleanSiteAddress(input.siteUrl ?? "");
  if (!siteUrl.ok) return siteUrl;
  return ok({ name: name.value, repo: { ...repo.value, branch }, contentPath, photoDir, siteUrl: siteUrl.value });
}

/**
 * A photo's address on the site, from where its file is in the repository.
 * A folder named `public` at the top is the site's root, as Vite and most
 * site builders have it.
 */
export function srcFor(photoDir: string, fileName: string): string {
  const folder = photoDir === "public" ? "" : photoDir.startsWith("public/") ? photoDir.slice("public/".length) : photoDir;
  return `/${folder ? `${folder}/` : ""}${fileName}`;
}

/** Where a photo's file is in the repository, from its address on the site. The other way round from `srcFor`. */
export function repoPathFor(photoDir: string, src: string): string {
  const root = photoDir === "public" || photoDir.startsWith("public/") ? "public" : "";
  return `${root}${src}`.replace(/^\//, "");
}

/** The content to show and change: the waiting changes if there are any, otherwise what is on the site. */
export const working = (site: ContentSite): SiteContent => site.draft ?? site.published;

/**
 * The site with a change made to its waiting content. A client's change to
 * something already sent takes it back to "editing", so nothing goes on the
 * site that they have not sent. Potomac's own change leaves it where it is.
 * A change that puts things back as they are on the site leaves nothing
 * waiting.
 */
export function withDraft(site: ContentSite, next: SiteContent, by: "client" | "staff"): ContentSite {
  if (sameContent(next, site.published)) return { ...site, draft: null, draftState: "none", submittedAt: null, submittedBy: null, note: "" };
  const state: DraftState = by === "client" || site.draftState === "none" ? "editing" : site.draftState;
  return { ...site, draft: next, draftState: state, ...(state === "editing" ? { submittedAt: null, submittedBy: null } : {}) };
}

export function submitted(site: ContentSite, by: string, at: string): Result<ContentSite, "nothing-to-send" | "already-sent"> {
  if (!site.draft) return err("nothing-to-send");
  if (site.draftState === "submitted") return err("already-sent");
  return ok({ ...site, draftState: "submitted", submittedAt: at, submittedBy: by, note: "" });
}

export function sentBack(site: ContentSite, typed: string): Result<ContentSite, "not-sent" | "note-missing" | "note-too-long"> {
  if (site.draftState !== "submitted") return err("not-sent");
  const note = requiredText(typed, 1000);
  if (!note.ok) return err(note.error === "missing" ? "note-missing" : "note-too-long");
  return ok({ ...site, draftState: "editing", submittedAt: null, submittedBy: null, note: note.value });
}

export function discarded(site: ContentSite): Result<ContentSite, "nothing-waiting"> {
  if (!site.draft) return err("nothing-waiting");
  return ok({ ...site, draft: null, draftState: "none", submittedAt: null, submittedBy: null, note: "" });
}

/** The waiting changes are on the site now. */
export function publishedAs(site: ContentSite, commit: string, at: string): ContentSite {
  return { ...site, published: site.draft ?? site.published, publishedAt: at, publishedCommit: commit, draft: null, draftState: "none", submittedAt: null, submittedBy: null, note: "" };
}
