import type { ReferralLink } from "../domain/link.ts";
import type { Id } from "../../shared/index.ts";

export type LinkCounts = {
  readonly scans: number;
  /** Scans since the instant given to `counts`. */
  readonly recentScans: number;
  readonly lastScanAt: string | null;
  /** The opportunities credited to the link, newest first. */
  readonly inquiries: readonly { readonly opportunityId: Id; readonly at: string }[];
};

/**
 * A QR code holding `text`, as an SVG picture named `title` for screen
 * readers. Null when the text is too long for one.
 */
export type QrMaker = (text: string, title: string) => string | null;

export type ReferralStore = {
  insert(link: ReferralLink, at: string): void;
  save(link: ReferralLink, at: string): void;
  remove(id: Id): void;
  get(id: Id): ReferralLink | null;
  byCode(code: string): ReferralLink | null;
  /** Newest first. */
  list(): ReferralLink[];
  addScan(linkId: Id, at: string): void;
  /** Credits an opportunity to a link. An opportunity is credited once. */
  addInquiry(linkId: Id, opportunityId: Id, at: string): void;
  counts(linkId: Id, recentFrom: string): LinkCounts;
};
