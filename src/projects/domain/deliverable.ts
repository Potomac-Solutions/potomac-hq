// Something handed to the client: a file attached to a project. It starts as
// a draft only Potomac sees. Sharing it lets the client see and download it.
// The client then approves it or asks for changes (roadmap v0.3 and v0.6).
import { optionalText, requiredText } from "../../shared/domain/fields.ts";
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const DELIVERABLE_STATUSES = ["draft", "shared", "approved", "changes-requested"] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

export type Deliverable = {
  readonly id: Id;
  readonly projectId: Id;
  readonly title: string;
  readonly description: string;
  readonly fileId: Id;
  readonly status: DeliverableStatus;
  readonly sharedAt: string | null;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  readonly createdBy: Id;
};

export type DeliverableError = "title-missing" | "title-too-long" | "description-too-long";

export function newDeliverable(ids: { readonly id: Id; readonly projectId: Id; readonly fileId: Id; readonly createdBy: Id }, input: { readonly title: string; readonly description?: string | null }): Result<Deliverable, DeliverableError> {
  const title = requiredText(input.title, 200);
  if (!title.ok) return err(title.error === "missing" ? "title-missing" : "title-too-long");
  const description = optionalText(input.description, 2000);
  if (!description.ok) return err("description-too-long");
  return ok({ ...ids, title: title.value, description: description.value ?? "", status: "draft", sharedAt: null, decidedAt: null, decisionNote: null });
}

/** Whether the client can see it. Everything but a draft is visible. */
export const isClientVisible = (deliverable: Deliverable): boolean => deliverable.status !== "draft";

/** A draft becomes shared. Sharing again after the client asked for changes reopens it for their decision. */
export function shareDeliverable(deliverable: Deliverable, at: string): Result<Deliverable, "already-shared"> {
  if (deliverable.status === "shared" || deliverable.status === "approved") return err("already-shared");
  return ok({ ...deliverable, status: "shared", sharedAt: at, decidedAt: null, decisionNote: null });
}

/** Back to a draft the client cannot see. An approved deliverable stays as the record of what was approved. */
export function unshareDeliverable(deliverable: Deliverable): Result<Deliverable, "not-shared" | "already-approved"> {
  if (deliverable.status === "draft") return err("not-shared");
  if (deliverable.status === "approved") return err("already-approved");
  return ok({ ...deliverable, status: "draft", sharedAt: null, decidedAt: null, decisionNote: null });
}

/** The client's decision. Asking for changes needs a note saying what. */
export function decideDeliverable(
  deliverable: Deliverable,
  decision: string,
  note: string | null | undefined,
  at: string,
): Result<Deliverable, "not-awaiting-decision" | "invalid-decision" | "note-required" | "note-too-long"> {
  if (deliverable.status !== "shared") return err("not-awaiting-decision");
  if (decision !== "approved" && decision !== "changes-requested") return err("invalid-decision");
  const text = optionalText(note, 2000);
  if (!text.ok) return err("note-too-long");
  if (decision === "changes-requested" && text.value === null) return err("note-required");
  return ok({ ...deliverable, status: decision, decidedAt: at, decisionNote: text.value });
}
