import type { ContentSite, Repo } from "../domain/site.ts";
import type { Point } from "../domain/service-area.ts";
import type { Id, Result } from "../../shared/index.ts";

export type ContentSiteStore = {
  insert(site: ContentSite, at: string): void;
  save(site: ContentSite, at: string): void;
  get(id: Id): ContentSite | null;
  /** A client's site, or null. A client has at most one. */
  forOrganization(organizationId: Id): ContentSite | null;
  /** Sites with changes sent in first, then by name. */
  list(): ContentSite[];
};

/** A photo's bytes, kept so it can be shown in HQ and put on the site. */
export type StoredPhoto = {
  readonly id: Id;
  readonly siteId: Id;
  /** Where its file is, or will be, in the repository. */
  readonly path: string;
  readonly contentType: string;
  /** True once the file is in the repository. */
  readonly inRepo: boolean;
};

export type PhotoStore = {
  put(photo: StoredPhoto, body: Uint8Array, at: string): void;
  get(id: Id): StoredPhoto | null;
  body(id: Id): Uint8Array | null;
  listFor(siteId: Id): StoredPhoto[];
  markInRepo(id: Id): void;
  remove(id: Id): void;
  removeAllFor(siteId: Id): void;
};

export type RepoError = "repo-refused" | "repo-missing" | "repo-changed" | "repo-failed";

/**
 * Reads from and commits to a site's repository. Never throws: a failure is
 * a result. `repo-missing` is a repository, branch or file that is not
 * there, or that the token may not see: GitHub answers the same for both.
 */
export type SitePublisher = {
  read(repo: Repo, path: string): Promise<Result<Uint8Array, RepoError>>;
  /** One commit that writes and removes the files given. Answers the commit's id. */
  commit(repo: Repo, change: { readonly message: string; readonly write: readonly { readonly path: string; readonly bytes: Uint8Array }[]; readonly remove: readonly string[] }): Promise<Result<{ readonly commit: string }, RepoError>>;
};

/** A county a service area can be picked from, with its outline: the largest piece first. */
export type County = { readonly fips: string; readonly name: string; readonly state: string; readonly rings: readonly (readonly Point[])[] };

/** The counties HQ knows the outlines of. */
export type CountyAtlas = {
  get(fips: string): County | null;
  /** Those that reach into a box of longitudes and latitudes. */
  within(box: { readonly west: number; readonly south: number; readonly east: number; readonly north: number }): County[];
};
