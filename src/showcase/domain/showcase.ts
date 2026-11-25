// Reviews and case studies (decision 0013, section 6): what clients say about
// Potomac, and the story of what was built for them, both kept as drafts
// until someone publishes them. Only what is published ever leaves HQ.
import type { Id } from "../../shared/domain/id.ts";
import { optionalText, requiredText } from "../../shared/domain/fields.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const REVIEW_SOURCES = ["client", "phone", "google", "facebook", "other"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];
export const REVIEW_SOURCE_LABELS: Readonly<Record<ReviewSource, string>> = { client: "Written by the client", phone: "Said on the phone", google: "On Google", facebook: "On Facebook", other: "Elsewhere" };

export type ReviewStatus = "waiting" | "published" | "hidden";

export type Review = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly rating: number;
  readonly text: string;
  /** The name to show, like "Rita M." */
  readonly displayName: string;
  readonly town: string;
  /** The writer said it may be shown. A review without it is never published. */
  readonly mayPublish: boolean;
  readonly source: ReviewSource;
  readonly status: ReviewStatus;
  readonly createdAt: string;
};

export type ReviewError = "rating-invalid" | "text-missing" | "text-too-long" | "name-missing" | "name-too-long" | "town-too-long" | "invalid-source";

export function reviewFields(input: { readonly rating: string; readonly text: string; readonly displayName: string; readonly town?: string | null; readonly source: string }): Result<Pick<Review, "rating" | "text" | "displayName" | "town" | "source">, ReviewError> {
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return err("rating-invalid");
  const text = requiredText(input.text.replace(/\r\n/g, "\n"), 1000);
  if (!text.ok) return err(text.error === "missing" ? "text-missing" : "text-too-long");
  const name = requiredText(input.displayName.replace(/\s+/g, " "), 80);
  if (!name.ok) return err(name.error === "missing" ? "name-missing" : "name-too-long");
  const town = optionalText((input.town ?? "").replace(/\s+/g, " "), 80);
  if (!town.ok) return err("town-too-long");
  if (!(REVIEW_SOURCES as readonly string[]).includes(input.source)) return err("invalid-source");
  return ok({ rating, text: text.value, displayName: name.value, town: town.value ?? "", source: input.source as ReviewSource });
}

/** How long the emailed link to write a review works. */
export const REQUEST_DAYS = 30;

export type CaseStudy = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly headline: string;
  readonly problem: string;
  readonly built: string;
  readonly result: string;
  readonly liveUrl: string;
  /** Its place on the Work page: lower first. */
  readonly position: number;
  readonly published: boolean;
};

export type CaseStudyError = "headline-missing" | "headline-too-long" | "text-too-long" | "url-invalid" | "position-invalid";

export function caseStudyFields(input: { readonly headline: string; readonly problem?: string | null; readonly built?: string | null; readonly result?: string | null; readonly liveUrl?: string | null; readonly position?: string | null }): Result<Pick<CaseStudy, "headline" | "problem" | "built" | "result" | "liveUrl" | "position">, CaseStudyError> {
  const headline = requiredText(input.headline.replace(/\s+/g, " "), 120);
  if (!headline.ok) return err(headline.error === "missing" ? "headline-missing" : "headline-too-long");
  const long = (value: string | null | undefined) => optionalText((value ?? "").replace(/\r\n/g, "\n"), 2000);
  const problem = long(input.problem);
  const built = long(input.built);
  const result = long(input.result);
  if (!problem.ok || !built.ok || !result.ok) return err("text-too-long");
  const url = (input.liveUrl ?? "").trim();
  if (url && (url.length > 300 || !/^https:\/\/[^\s/@]+\.[^\s/@]+(\/[^\s]*)?$/.test(url))) return err("url-invalid");
  const positionText = (input.position ?? "").trim();
  const position = positionText === "" ? 100 : Number(positionText);
  if (!Number.isInteger(position) || position < 1 || position > 999) return err("position-invalid");
  return ok({ headline: headline.value, problem: problem.value ?? "", built: built.value ?? "", result: result.value ?? "", liveUrl: url, position });
}

/** Up to this many screenshots a case study, each a web-sized picture. */
export const MAX_SHOTS = 6;
export const MAX_SHOT_BYTES = 3 * 1024 * 1024;

export type ShotError = "shot-missing" | "shot-too-large" | "shot-not-a-picture" | "alt-missing" | "alt-too-long" | "too-many-shots";

const starts = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean => signature.every((byte, i) => bytes[at + i] === byte);

/** A screenshot's type, from its first bytes, never from what the browser says. */
export function checkShot(bytes: Uint8Array | null | undefined): Result<string, "shot-missing" | "shot-too-large" | "shot-not-a-picture"> {
  if (!bytes || bytes.length === 0) return err("shot-missing");
  if (bytes.length > MAX_SHOT_BYTES) return err("shot-too-large");
  if (starts(bytes, [0xff, 0xd8, 0xff])) return ok("image/jpeg");
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ok("image/png");
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return ok("image/webp");
  return err("shot-not-a-picture");
}

export function shotAlt(typed: string): Result<string, "alt-missing" | "alt-too-long"> {
  const alt = requiredText(typed.replace(/\s+/g, " "), 200);
  return alt.ok ? ok(alt.value) : err(alt.error === "missing" ? "alt-missing" : "alt-too-long");
}

/** "★★★★☆" */
export const stars = (rating: number): string => "★".repeat(rating) + "☆".repeat(5 - rating);
