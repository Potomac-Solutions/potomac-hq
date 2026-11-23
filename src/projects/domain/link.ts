// A project link: where some of the project's work can be seen. The code,
// the staging and live sites, the designs, documents. Shared ones show in the
// client's portal; the rest are for Potomac only.
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const LINK_KINDS = ["staging", "live", "design", "docs", "repository", "other"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const LINK_KIND_LABELS: Readonly<Record<LinkKind, string>> = {
  staging: "Staging site",
  live: "Live site",
  design: "Designs",
  docs: "Documents",
  repository: "Code repository",
  other: "Other",
};

export type ProjectLink = {
  readonly id: Id;
  readonly projectId: Id;
  readonly kind: LinkKind;
  /** Optional; the kind's name is used when empty. */
  readonly label: string;
  readonly url: string;
  readonly shared: boolean;
  readonly createdBy: Id;
};

export type LinkInput = { readonly kind: string; readonly label?: string | null; readonly url: string; readonly shared: boolean };
export type LinkError = "invalid-kind" | "label-too-long" | "invalid-url";

/** A web address, with https:// added when it was typed without one. */
export function cleanUrl(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > 500 || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

export function newProjectLink(ids: { readonly id: Id; readonly projectId: Id; readonly createdBy: Id }, input: LinkInput): Result<ProjectLink, LinkError> {
  if (!(LINK_KINDS as readonly string[]).includes(input.kind)) return err("invalid-kind");
  const label = (input.label ?? "").trim();
  if (label.length > 80) return err("label-too-long");
  const url = cleanUrl(input.url);
  if (url === null) return err("invalid-url");
  return ok({ ...ids, kind: input.kind as LinkKind, label, url, shared: input.shared });
}

/** What the link is called on a page. */
export const linkName = (link: Pick<ProjectLink, "kind" | "label">): string => link.label || LINK_KIND_LABELS[link.kind];
