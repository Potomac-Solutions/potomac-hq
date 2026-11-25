import type { PostStatus, SocialPlan, SocialPost } from "../domain/social.ts";
import type { Id } from "../../shared/index.ts";

export type SocialStore = {
  insertPlan(plan: SocialPlan, at: string): void;
  updatePlan(plan: SocialPlan, at: string): void;
  planFor(organizationId: Id): SocialPlan | null;
  plans(): SocialPlan[];
  insertPost(post: SocialPost, createdBy: Id | null, at: string): void;
  updatePost(post: SocialPost, at: string): void;
  removePost(id: Id): void;
  post(id: Id): SocialPost | null;
  /** A client's posts in a month (YYYY-MM), by day. */
  month(organizationId: Id, month: string): SocialPost[];
  /** Every client's posts in a month, by day. */
  everyonesMonth(month: string): SocialPost[];
  /** Every post with a status, by day. */
  withStatus(status: PostStatus): SocialPost[];
  /** A client's posts with a status, by day. */
  clientsWithStatus(organizationId: Id, status: PostStatus): SocialPost[];
};

/** A client's name, from the CRM, or null when there is no such client. */
export type ClientNames = (organizationId: Id) => string | null;
