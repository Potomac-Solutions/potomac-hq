// Referral links: a short address, usually printed as a QR code on a
// business card or a flyer, that sends whoever scans it on to a page and
// counts the scan. An inquiry that follows is counted too, so each link
// shows how well it works.
import type { Id } from "../../shared/domain/id.ts";
import { requiredText } from "../../shared/domain/fields.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type ReferralLink = {
  readonly id: Id;
  /** The end of the short address, /r/<code>: lower-case letters, digits and hyphens. Never changes, because it is printed. */
  readonly code: string;
  /** What it is printed on, for Potomac's people: "Business cards, winter 2026". */
  readonly label: string;
  /** Where a scan goes: an https address, or one of HQ's own pages such as /contact. */
  readonly destination: string;
  readonly createdBy: Id;
};

export type LinkError = "label-missing" | "label-too-long" | "code-invalid" | "destination-invalid";

/** The name the code travels under in the destination's address, and in the inquiry form. */
export const REF_FIELD = "ref";

/** A code someone typed, or null when it cannot be one. */
export function cleanCode(typed: string): string | null {
  const code = typed.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])$/.test(code) ? code : null;
}

/** A code for a link whose maker did not choose one: six letters and digits that are hard to misread. */
export function codeFrom(random: Uint8Array): string {
  const letters = "abcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += letters[(random[i] ?? 0) % letters.length];
  return code;
}

/**
 * Where a scan may be sent: a public https address, or a page of HQ's own
 * ("/contact", "/book"). No passwords in it, and nothing but https, so a
 * printed code can never open something else.
 */
export function cleanDestination(typed: string): Result<string, "destination-invalid"> {
  const text = typed.trim();
  if (text.length === 0 || text.length > 300) return err("destination-invalid");
  if (text.startsWith("/")) return /^\/(?!\/)[A-Za-z0-9/_\-.~?=&%#]*$/.test(text) && !text.startsWith("/r/") ? ok(text) : err("destination-invalid");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return err("destination-invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return err("destination-invalid");
  return ok(url.toString());
}

export function newLink(ids: { readonly id: Id; readonly createdBy: Id }, input: { readonly code: string; readonly label: string; readonly destination: string }): Result<ReferralLink, LinkError> {
  const label = requiredText(input.label, 120);
  if (!label.ok) return err(label.error === "missing" ? "label-missing" : "label-too-long");
  const code = cleanCode(input.code);
  if (code === null) return err("code-invalid");
  const destination = cleanDestination(input.destination);
  if (!destination.ok) return destination;
  return ok({ ...ids, code, label: label.value, destination: destination.value });
}

/** The link with a new label and destination. Its code stays: it is already printed. */
export function editedLink(link: ReferralLink, input: { readonly label: string; readonly destination: string }): Result<ReferralLink, LinkError> {
  const made = newLink({ id: link.id, createdBy: link.createdBy }, { ...input, code: link.code });
  return made.ok ? ok({ ...made.value, code: link.code }) : made;
}

/** Where a scan lands: the destination, carrying the code so an inquiry made there can be credited to it. */
export function landingFor(link: ReferralLink): string {
  if (link.destination.startsWith("/")) {
    const [before = "", hash] = link.destination.split("#");
    const [path = "", query = ""] = before.split("?");
    const params = new URLSearchParams(query);
    params.set(REF_FIELD, link.code);
    return `${path}?${params.toString()}${hash === undefined ? "" : `#${hash}`}`;
  }
  const url = new URL(link.destination);
  url.searchParams.set(REF_FIELD, link.code);
  return url.toString();
}

/**
 * True for a program fetching the address, not a person scanning it: link
 * previews in chat apps, search crawlers, uptime checks. Their visits are
 * not scans.
 */
export function isAutomated(userAgent: string): boolean {
  return userAgent.trim() === "" || /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|curl\/|wget\/|python-|headless|monitor|pingdom|uptime/i.test(userAgent);
}

/** How well a link works: "3 of 40 scans led to an inquiry (7.5%)". */
export function successRate(scans: number, inquiries: number): string {
  if (scans === 0) return inquiries === 0 ? "No scans yet" : `${inquiries} ${inquiries === 1 ? "inquiry" : "inquiries"}, no scans counted`;
  const share = (inquiries / scans) * 100;
  const percent = share === 0 || share >= 10 ? Math.round(share).toString() : share.toFixed(1);
  return `${inquiries} of ${scans} ${scans === 1 ? "scan" : "scans"} led to an inquiry (${percent}%)`;
}
