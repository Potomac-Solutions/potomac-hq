import type { CheckResult, Site } from "../domain/site.ts";
import type { Id } from "../../shared/index.ts";

export type SiteStore = {
  insert(site: Site, at: string): void;
  save(site: Site, at: string): void;
  get(id: Id): Site | null;
  listActive(): Site[];
  listFor(organizationId: Id): Site[];
  startOutage(siteId: Id, at: string, reason: string): void;
  endOutage(siteId: Id, at: string): void;
  /** Outages that overlap from..now. */
  outages(siteId: Id, from: string): { readonly start: string; readonly end: string | null; readonly reason: string }[];
};

/** Checks one address from HQ's server. Never throws: a failure is a result. */
export type SiteChecker = (url: string) => Promise<CheckResult>;

/** Tells Potomac's people about a change. Answers false when it could not. */
export type SiteAlert = (message: { readonly subject: string; readonly body: string }) => Promise<boolean>;
