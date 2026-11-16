// What the dashboard's activity panel may show. The words for each event are
// shared by every module (src/shared/domain/wording.ts).
export { describeAction, describeEvent } from "../../shared/domain/wording.ts";

/** Record types every signed-in role may see activity for. */
export const CLIENT_RECORD_TYPES = [
  "client-organization",
  "contact",
  "opportunity",
  "project",
  "phase",
  "milestone",
  "task",
  "note",
  "deliverable",
] as const;

export type FeedScope = "everything" | "client-records";

export const FEED_LIMIT = 20;
