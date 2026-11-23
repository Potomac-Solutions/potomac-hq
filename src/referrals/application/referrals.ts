// Referral links: make one for a batch of business cards or a flyer, print
// its QR code, and see how many scans it gets and how many led to an
// inquiry. Made, changed and seen with `referral.manage`. A scan is anyone
// on the internet, so following a link needs no permission.
import { cleanCode, codeFrom, editedLink, isAutomated, landingFor, newLink, successRate, type LinkError, type ReferralLink } from "../domain/link.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, qrCode, qrSvg, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { ReferralStore } from "./ports.ts";

export type ReferralsDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly links: ReferralStore;
  /** An opportunity's title, for the list of inquiries. Null when it is gone. */
  readonly opportunityTitle: (id: Id) => string | null;
  readonly formatWhen: (instant: string) => string;
  /** Random bytes, for a code nobody chose. */
  readonly random: (length: number) => Uint8Array;
};

type Refused = "forbidden" | "not-found";
const allowed = (deps: ReferralsDeps, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "referral.manage").ok;
const MAX_LINKS = 500;

export type LinkInput = { readonly code?: string | null; readonly label: string; readonly destination: string };

/** Makes a link. With no code given, HQ makes one up. */
export function addReferralLink(deps: ReferralsDeps, actorId: Id | null, input: LinkInput): Result<ReferralLink, Refused | LinkError | "code-taken" | "too-many"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    if (deps.links.list().length >= MAX_LINKS) return err("too-many");
    let code = (input.code ?? "").trim();
    if (code === "") {
      // Six characters from thirty-one: a clash is rare, and tried again.
      for (let tries = 0; tries < 20 && (code === "" || deps.links.byCode(code)); tries++) code = codeFrom(deps.random(6));
    }
    const made = newLink({ id: deps.newId(), createdBy: actorId }, { code, label: input.label, destination: input.destination });
    if (!made.ok) return made;
    if (deps.links.byCode(made.value.code)) return err("code-taken");
    deps.links.insert(made.value, deps.clock());
    recordActivity(deps, { actorId, action: "referral-link.created", recordType: "referral-link", recordId: made.value.id, context: { code: made.value.code, label: made.value.label, destination: made.value.destination } });
    return ok(made.value);
  });
}

/** Changes what a link is called and where it goes. Its code is printed, so it stays. */
export function editReferralLink(deps: ReferralsDeps, actorId: Id | null, id: Id, input: { readonly label: string; readonly destination: string }): Result<ReferralLink, Refused | LinkError> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const found = deps.links.get(id);
    if (!found) return err("not-found");
    const edited = editedLink(found, input);
    if (!edited.ok) return edited;
    deps.links.save(edited.value, deps.clock());
    recordActivity(deps, { actorId, action: "referral-link.edited", recordType: "referral-link", recordId: id, context: { code: found.code, label: edited.value.label, destination: edited.value.destination } });
    return ok(edited.value);
  });
}

/** Removes a link nobody has scanned. One that has been scanned is in use, and stays. */
export function removeReferralLink(deps: ReferralsDeps, actorId: Id | null, id: Id): Result<ReferralLink, Refused | "in-use"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const found = deps.links.get(id);
    if (!found) return err("not-found");
    const counts = deps.links.counts(id, deps.clock());
    if (counts.scans > 0 || counts.inquiries.length > 0) return err("in-use");
    deps.links.remove(id);
    recordActivity(deps, { actorId, action: "referral-link.removed", recordType: "referral-link", recordId: id, context: { code: found.code, label: found.label } });
    return ok(found);
  });
}

/**
 * Someone opened /r/<code>. Answers where to send them, or null when there
 * is no such link. A person's visit is counted as a scan: the time only,
 * nothing about them or their device. A program's visit (a link preview, a
 * crawler) is sent on and not counted.
 *
 * No activity event: a scan is not a change someone made, and a busy link
 * would bury the history. The scan's own row is the record.
 */
export function followReferralLink(deps: ReferralsDeps, typedCode: string, userAgent: string): string | null {
  const code = cleanCode(typedCode);
  const link = code ? deps.links.byCode(code) : null;
  if (!link) return null;
  if (!isAutomated(userAgent)) deps.links.addScan(link.id, deps.clock());
  return landingFor(link);
}

/**
 * An inquiry arrived carrying a link's code: credit the opportunity to the
 * link. Anything that is not a link's code is ignored, since the code comes
 * from the form and anyone can type one.
 */
export function creditInquiry(deps: ReferralsDeps, typedCode: string, opportunityId: Id): boolean {
  const code = cleanCode(typedCode);
  if (!code) return false;
  return deps.transact(() => {
    const link = deps.links.byCode(code);
    if (!link) return false;
    deps.links.addInquiry(link.id, opportunityId, deps.clock());
    recordActivity(deps, { actorId: null, action: "referral-link.inquiry", recordType: "referral-link", recordId: link.id, context: { code: link.code, opportunityId } });
    return true;
  });
}

export type ReferralLine = {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly destination: string;
  /** The address to print: https://hq.potomac.solutions/r/card */
  readonly address: string;
  readonly scans: number;
  readonly recentScans: number;
  readonly lastScan: string;
  readonly inquiryCount: number;
  readonly rate: string;
  readonly inquiries: readonly { readonly opportunityId: string; readonly title: string; readonly when: string }[];
  readonly removable: boolean;
  /** False when the address is too long for HQ's QR codes. */
  readonly scannable: boolean;
};

export type ReferralsView = { readonly links: readonly ReferralLine[]; readonly totalScans: number; readonly totalInquiries: number; readonly publicUrlSet: boolean };

const addressOf = (publicUrl: string, code: string) => `${publicUrl}/r/${code}`;

/** Every link with its counts, newest first. `publicUrl` is HQ's own address, with no slash at the end. */
export function referralLinks(deps: ReferralsDeps, actorId: Id | null, publicUrl: string): Result<ReferralsView, "forbidden"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const monthAgo = Temporal.Instant.from(deps.clock()).subtract({ hours: 24 * 30 }).toString();
  const links = deps.links.list().map((link): ReferralLine => {
    const counts = deps.links.counts(link.id, monthAgo);
    const address = addressOf(publicUrl, link.code);
    return {
      id: link.id,
      code: link.code,
      label: link.label,
      destination: link.destination,
      address,
      scans: counts.scans,
      recentScans: counts.recentScans,
      lastScan: counts.lastScanAt ? deps.formatWhen(counts.lastScanAt) : "",
      inquiryCount: counts.inquiries.length,
      rate: successRate(counts.scans, counts.inquiries.length),
      inquiries: counts.inquiries.slice(0, 5).map((one) => ({ opportunityId: one.opportunityId, title: deps.opportunityTitle(one.opportunityId) ?? "An opportunity", when: deps.formatWhen(one.at) })),
      removable: counts.scans === 0 && counts.inquiries.length === 0,
      scannable: publicUrl !== "" && qrCode(address) !== null,
    };
  });
  return ok({ links, totalScans: links.reduce((sum, one) => sum + one.scans, 0), totalInquiries: links.reduce((sum, one) => sum + one.inquiryCount, 0), publicUrlSet: publicUrl !== "" });
}

/** A link's QR code as an SVG picture, ready to print at any size. */
export function referralQr(deps: ReferralsDeps, actorId: Id | null, id: Id, publicUrl: string): Result<{ readonly svg: string; readonly fileName: string }, Refused> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const link = deps.links.get(id);
  const code = link && publicUrl !== "" ? qrCode(addressOf(publicUrl, link.code)) : null;
  if (!link || !code) return err("not-found");
  return ok({ svg: qrSvg(code, `QR code for ${link.label}`), fileName: `qr-${link.code}.svg` });
}
