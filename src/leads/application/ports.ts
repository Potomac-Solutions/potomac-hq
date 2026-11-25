import type { LeadRow, LeadTouch } from "../domain/source.ts";
import type { Id } from "../../shared/index.ts";

export type LeadStore = {
  /** Keeps the first touch for an opportunity. A second is ignored. */
  keepFirst(opportunityId: Id, touch: LeadTouch, at: string): void;
  get(opportunityId: Id): (LeadTouch & { readonly receivedAt: string }) | null;
  /** The newest open opportunity at a client: the one a new booking made. */
  newestOpenAt(organizationId: Id): Id | null;
  /** Every real (not demo) opportunity made since an instant, with what became of it by `now`. */
  rows(since: string, now: string): LeadRow[];
};
