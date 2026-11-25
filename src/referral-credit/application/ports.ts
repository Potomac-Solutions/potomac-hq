import type { Id } from "../../shared/index.ts";

export type ReferralCreditStore = {
  /** Who referred an opportunity, and the client the opportunity is at. */
  referredBy(opportunityId: Id): { readonly organizationId: Id | null; readonly name: string | null; readonly clientId: Id } | null;
  setReferredBy(opportunityId: Id, who: { readonly organizationId: Id | null; readonly name: string | null }, at: string): void;
  /** The client whose own referral link an opportunity came by, if it did. */
  linkOwnerFor(opportunityId: Id): Id | null;
  /** A client's own referral link. */
  linkFor(organizationId: Id): { readonly id: Id; readonly code: string } | null;
  setLinkOwner(linkId: Id, organizationId: Id): void;
  /** Opportunities a client referred, newest first. */
  referredByClient(organizationId: Id): { readonly opportunityId: Id; readonly title: string; readonly clientId: Id; readonly createdAt: string }[];
  /** Clients referred by another who have paid an invoice, with no credit given for them yet. */
  creditsDue(): { readonly referrerId: Id; readonly referredId: Id }[];
  addCredit(credit: { readonly id: Id; readonly referrerId: Id; readonly referredId: Id; readonly minor: number; readonly at: string }): void;
  credits(referrerId: Id): { readonly referredId: Id; readonly minor: number; readonly at: string }[];
  earnedMinor(referrerId: Id): number;
  usedMinor(referrerId: Id): number;
  addUse(use: { readonly id: Id; readonly referrerId: Id; readonly invoiceId: Id; readonly minor: number; readonly userId: Id; readonly at: string }): void;
  removeUse(id: Id): void;
  creditMinor(): number | null;
  setCreditMinor(minor: number, userId: Id, at: string): void;
  /** An invoice's client, total and status. */
  invoice(invoiceId: Id): { readonly organizationId: Id; readonly totalMinor: number; readonly status: string } | null;
};
