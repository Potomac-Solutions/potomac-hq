// A client's request from the portal (2026-11-26), and where it stands as the
// client reads it. Where it stands comes from the task HQ made of it.
import { err, ok, type Result } from "../../shared/domain/result.ts";
import type { Id } from "../../shared/domain/id.ts";

export type ClientRequest = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly projectId: Id | null;
  readonly clientUserId: Id;
  readonly title: string;
  readonly details: string;
  readonly taskId: Id | null;
  readonly declinedNote: string;
  readonly declinedAt: string | null;
  readonly createdAt: string;
};

export type RequestError = "title-missing" | "title-too-long" | "details-too-long";

export function readRequest(input: { readonly title: string; readonly details?: string | null }): Result<{ title: string; details: string }, RequestError> {
  const title = input.title.trim().replace(/\s+/g, " ");
  if (!title) return err("title-missing");
  if (title.length > 120) return err("title-too-long");
  const details = (input.details ?? "").trim().replace(/\r\n/g, "\n");
  if (details.length > 2000) return err("details-too-long");
  return ok({ title, details });
}

export type RequestStanding = "received" | "working" | "waiting" | "done" | "not-going-ahead";

export const STANDING_LABELS: Readonly<Record<RequestStanding, string>> = {
  received: "Received",
  working: "Being worked on",
  waiting: "Waiting on something",
  done: "Done",
  "not-going-ahead": "Not going ahead",
};

/** Where a request stands, from its task's status. A task removed since reads as received. */
export function standing(request: Pick<ClientRequest, "declinedAt">, taskStatus: string | null): RequestStanding {
  if (request.declinedAt) return "not-going-ahead";
  if (taskStatus === "done") return "done";
  if (taskStatus === "doing") return "working";
  if (taskStatus === "blocked") return "waiting";
  return "received";
}
