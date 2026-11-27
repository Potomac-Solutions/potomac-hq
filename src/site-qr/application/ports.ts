import type { CodeCounts, EventKind, SiteQrCode } from "../domain/code.ts";
import type { Id } from "../../shared/index.ts";

export type SiteQrStore = {
  insert(code: SiteQrCode, by: { readonly userId: Id } | { readonly clientUserId: Id }, at: string): void;
  /** Saves the label and whether it's retired. Nothing else changes: it's printed. */
  save(code: SiteQrCode, at: string): void;
  remove(id: Id): void;
  get(id: Id): SiteQrCode | null;
  byCode(organizationId: Id, code: string): SiteQrCode | null;
  /** Newest first, retired ones too. */
  listFor(organizationId: Id): SiteQrCode[];
  addEvent(codeId: Id, kind: EventKind, happenedAt: string, receivedAt: string): void;
  counts(codeId: Id, recentFrom: string): CodeCounts;
  hasEvents(codeId: Id): boolean;
  /** When HQ last heard from any of a client's sites. */
  lastHeard(organizationId: Id): string | null;
};

/** A QR code holding `text`: an SVG named `title` for screen readers, or a square PNG. Null when the text is too long. */
export type QrPictures = {
  svg(text: string, title: string): string | null;
  png(text: string): Uint8Array | null;
};
