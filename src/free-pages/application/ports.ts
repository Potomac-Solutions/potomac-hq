import type { FreePage, Round } from "../domain/free-page.ts";
import type { Id } from "../../shared/index.ts";

export type FreePageStore = {
  get(id: Id): FreePage | null;
  forOrganization(organizationId: Id): FreePage | null;
  bySubdomain(subdomain: string): FreePage | null;
  byOwnDomain(domain: string): FreePage | null;
  /** Newest first. */
  list(): FreePage[];
  insert(page: FreePage, at: string): void;
  save(page: FreePage, at: string): void;
};

export type RoundStore = {
  /** In order. */
  listFor(freePageId: Id): Round[];
  get(id: Id): Round | null;
  insert(round: Round, who: { readonly clientUserId: Id } | { readonly userId: Id }): void;
  markDone(id: Id, userId: Id, at: string): void;
  /** Rounds nobody has marked done, oldest first. */
  open(): Round[];
};

/** A zip of a repository's branch, from GitHub. Null when it can't be had. */
export type SiteArchive = (repo: { readonly owner: string; readonly name: string; readonly branch: string }) => Promise<Uint8Array | null>;
