// Public entry for referral links: short addresses printed as QR codes,
// with a count of scans and of the inquiries that followed.
export * from "./application/referrals.ts";
export type { LinkCounts, ReferralStore } from "./application/ports.ts";
export { REF_FIELD, type ReferralLink } from "./domain/link.ts";
