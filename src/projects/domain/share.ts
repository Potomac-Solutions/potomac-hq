// Sharing a project by link (decision 0007, section 11). A link needs no
// account and works until it's stopped or its expiry day passes. Each link
// has its rights: "see" (phases, milestones, tasks with their status and due
// dates, and shared deliverables) or "comment" (see, and comment on tasks).
// It never shows internal notes, time, estimates, money or other projects.
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const SHARE_RIGHTS = ["see", "comment"] as const;
export type ShareRights = (typeof SHARE_RIGHTS)[number];

export type ShareLink = {
  readonly id: Id;
  readonly projectId: Id;
  /** Who it's for, so a list of links makes sense: "Dale at Better Days". */
  readonly label: string;
  readonly rights: ShareRights;
  /** The last day it works, YYYY-MM-DD in the business time zone, or null for until stopped. */
  readonly expiresOn: string | null;
  readonly createdBy: Id;
  readonly createdAt: string;
  readonly stoppedAt: string | null;
};

export type ShareError = "label-missing" | "label-too-long" | "invalid-rights" | "invalid-date" | "expiry-in-the-past";

export function newShareLink(
  ids: { readonly id: Id; readonly projectId: Id; readonly createdBy: Id; readonly createdAt: string },
  input: { readonly label: string; readonly rights: string; readonly expiresOn?: string | null },
  today: string,
): Result<ShareLink, ShareError> {
  const label = input.label.trim();
  if (label === "") return err("label-missing");
  if (label.length > 80) return err("label-too-long");
  if (!(SHARE_RIGHTS as readonly string[]).includes(input.rights)) return err("invalid-rights");
  const expiry = (input.expiresOn ?? "").trim();
  if (expiry !== "") {
    try {
      Temporal.PlainDate.from(expiry, { overflow: "reject" });
    } catch {
      return err("invalid-date");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return err("invalid-date");
    if (expiry < today) return err("expiry-in-the-past");
  }
  return ok({ ...ids, label, rights: input.rights as ShareRights, expiresOn: expiry || null, stoppedAt: null });
}

export type ShareState = "live" | "stopped" | "expired";

/** Whether a link works today. */
export function shareState(link: Pick<ShareLink, "stoppedAt" | "expiresOn">, today: string): ShareState {
  if (link.stoppedAt !== null) return "stopped";
  if (link.expiresOn !== null && link.expiresOn < today) return "expired";
  return "live";
}

/** A visitor's name on a comment: required, short, one line. */
export function guestName(text: string): Result<string, "guest-name-missing" | "guest-name-too-long"> {
  const name = text.replace(/\s+/g, " ").trim();
  if (name === "") return err("guest-name-missing");
  if (name.length > 60) return err("guest-name-too-long");
  return ok(name);
}
