import type { Demo } from "../domain/demo.ts";
import type { Id } from "../../shared/index.ts";

export type DemoStore = {
  get(id: Id): Demo | null;
  /** By name. */
  list(): Demo[];
  insert(demo: Demo, at: string): void;
  save(demo: Demo, at: string): void;
  /** Whether it has ever been sent: a sent demo is kept, only turned off. */
  everSent(id: Id): boolean;
  remove(id: Id): void;
};

export type DemoLink = { readonly id: Id; readonly code: string; readonly demoId: Id; readonly opportunityId: Id; readonly sentAt: string };

export type DemoLinkStore = {
  insert(link: DemoLink & { readonly sentBy: Id }): void;
  byCode(code: string): DemoLink | null;
  /** An opportunity's links, newest first, with their opens. */
  forOpportunity(opportunityId: Id): (DemoLink & { readonly opens: number; readonly lastOpenedAt: string | null })[];
  addOpen(linkId: Id, at: string): void;
  /** Opportunities whose demos were opened since an instant, with the newest open and what was opened. */
  openedSince(since: string): { readonly opportunityId: Id; readonly lastOpenedAt: string; readonly opens: number; readonly demos: readonly string[] }[];
};
