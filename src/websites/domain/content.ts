// What a client may change on their own website: the photo gallery, a short
// notice, and customer reviews. The rules here decide what a change may be.
// A site with no gallery has none of the three: its file is read and written
// back as it was, for its status and service area alone.
// Nothing here knows where the site lives or how it is published.
import type { Id } from "../../shared/domain/id.ts";
import { parseId } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

/** A field of the site's own that HQ carries through untouched, such as a photo's crop. */
export type Extra = Readonly<Record<string, unknown>>;

export type Photo = {
  readonly id: Id;
  /** Its address on the site, like /gallery/paint-booth.webp. */
  readonly src: string;
  /** What the photo shows, for someone who cannot see it. */
  readonly alt: string;
  readonly title: string;
  readonly caption: string;
  readonly extra: Extra;
};

export type Review = { readonly quote: string; readonly by: string };

export type SiteContent = {
  /** True for a site whose file has no gallery: it has no photos, notice or reviews to change. */
  readonly noGallery?: true;
  /** One short line shown at the top of the site. Empty for none. */
  readonly notice: string;
  readonly gallery: readonly Photo[];
  readonly reviews: readonly Review[];
  readonly extra: Extra;
};

export const MAX_PHOTOS = 30;
export const MAX_REVIEWS = 12;
export const LIMITS = { notice: 160, title: 60, alt: 200, caption: 200, quote: 700, by: 80 } as const;

export type ContentError =
  | "title-missing"
  | "title-too-long"
  | "alt-missing"
  | "alt-too-long"
  | "caption-too-long"
  | "notice-too-long"
  | "quote-missing"
  | "quote-too-long"
  | "by-missing"
  | "by-too-long"
  | "too-many-photos"
  | "too-many-reviews"
  | "last-photo"
  | "no-such-photo"
  | "no-such-review"
  | "unchanged";

/** One line, no control characters, single spaces. */
const line = (text: string | null | undefined): string => (text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
/** Several lines allowed, trimmed, no other control characters. */
const prose = (text: string | null | undefined): string => (text ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").replace(/\n{3,}/g, "\n\n").trim();

export type PhotoWords = { readonly title: string; readonly alt: string; readonly caption?: string | null };

export function photoWords(input: PhotoWords): Result<{ title: string; alt: string; caption: string }, ContentError> {
  const title = line(input.title);
  if (!title) return err("title-missing");
  if (title.length > LIMITS.title) return err("title-too-long");
  const alt = line(input.alt);
  if (!alt) return err("alt-missing");
  if (alt.length > LIMITS.alt) return err("alt-too-long");
  const caption = line(input.caption);
  if (caption.length > LIMITS.caption) return err("caption-too-long");
  return ok({ title, alt, caption });
}

/** Adds a photo at the end. */
export function withPhoto(content: SiteContent, photo: { readonly id: Id; readonly src: string }, input: PhotoWords): Result<SiteContent, ContentError> {
  if (content.gallery.length >= MAX_PHOTOS) return err("too-many-photos");
  const words = photoWords(input);
  if (!words.ok) return words;
  return ok({ ...content, gallery: [...content.gallery, { ...photo, ...words.value, extra: {} }] });
}

export function withPhotoWords(content: SiteContent, id: Id, input: PhotoWords): Result<SiteContent, ContentError> {
  const found = content.gallery.find((one) => one.id === id);
  if (!found) return err("no-such-photo");
  const words = photoWords(input);
  if (!words.ok) return words;
  if (words.value.title === found.title && words.value.alt === found.alt && words.value.caption === found.caption) return err("unchanged");
  return ok({ ...content, gallery: content.gallery.map((one) => (one.id === id ? { ...one, ...words.value } : one)) });
}

/** A site keeps at least one photo: its gallery is built around the first. */
export function withoutPhoto(content: SiteContent, id: Id): Result<SiteContent, ContentError> {
  if (!content.gallery.some((one) => one.id === id)) return err("no-such-photo");
  if (content.gallery.length === 1) return err("last-photo");
  return ok({ ...content, gallery: content.gallery.filter((one) => one.id !== id) });
}

export type Move = "up" | "down" | "first";
export const isMove = (text: string): text is Move => text === "up" || text === "down" || text === "first";

export function withPhotoMoved(content: SiteContent, id: Id, move: Move): Result<SiteContent, ContentError> {
  const from = content.gallery.findIndex((one) => one.id === id);
  if (from < 0) return err("no-such-photo");
  const to = move === "first" ? 0 : move === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= content.gallery.length || to === from) return err("unchanged");
  const gallery = [...content.gallery];
  const [moved] = gallery.splice(from, 1);
  gallery.splice(to, 0, moved as Photo);
  return ok({ ...content, gallery });
}

export function withNotice(content: SiteContent, typed: string): Result<SiteContent, ContentError> {
  const notice = line(typed);
  if (notice.length > LIMITS.notice) return err("notice-too-long");
  if (notice === content.notice) return err("unchanged");
  return ok({ ...content, notice });
}

export function withReview(content: SiteContent, input: { readonly quote: string; readonly by: string }): Result<SiteContent, ContentError> {
  if (content.reviews.length >= MAX_REVIEWS) return err("too-many-reviews");
  const quote = prose(input.quote).replace(/^[“"]+|[”"]+$/g, "").trim();
  if (!quote) return err("quote-missing");
  if (quote.length > LIMITS.quote) return err("quote-too-long");
  const by = line(input.by);
  if (!by) return err("by-missing");
  if (by.length > LIMITS.by) return err("by-too-long");
  return ok({ ...content, reviews: [...content.reviews, { quote, by }] });
}

export function withoutReview(content: SiteContent, index: number): Result<SiteContent, ContentError> {
  if (!Number.isInteger(index) || index < 0 || index >= content.reviews.length) return err("no-such-review");
  return ok({ ...content, reviews: content.reviews.filter((_, at) => at !== index) });
}

// ── Reading and writing the site's own file ──────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** A photo's address on the site: starts with one slash, plain names, an image's ending. */
export function isPhotoSrc(src: string): boolean {
  return /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:jpe?g|png|webp|avif|gif)$/i.test(src) && !src.includes("..") && src.length <= 200;
}

/** True when the site has photos, a notice and reviews to change. */
export const hasGallery = (content: SiteContent): boolean => content.noGallery !== true;

/**
 * The site's content file, read. A `gallery` list, when there is one, must
 * hold at least one photo; `notice` and `testimonials` may be missing. A
 * photo with no id of its own is given one. A file with no `gallery` is a
 * site with no photos, notice or reviews to change: it must hold a
 * `serviceArea` or a `launch` block, and no notice or reviews. Anything else
 * in the file is kept and written back as it was.
 */
export function readContent(json: string, newId: () => Id): Result<SiteContent, "content-invalid"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return err("content-invalid");
  }
  if (!isRecord(parsed)) return err("content-invalid");
  // `launch` is the site's status and `serviceArea` where it goes: each read and written on its own (launch.ts, service-area.ts).
  if (!("gallery" in parsed)) {
    // Without a gallery the file must be for a status or a service area, and can't half-hold the rest: an empty or stray file is more likely the wrong file.
    if (!isRecord(parsed["serviceArea"]) && !isRecord(parsed["launch"])) return err("content-invalid");
    if ("notice" in parsed || "testimonials" in parsed) return err("content-invalid");
    const { launch: _launch, serviceArea: _area, ...rest } = parsed;
    return ok({ noGallery: true, notice: "", gallery: [], reviews: [], extra: rest });
  }
  if (!Array.isArray(parsed["gallery"]) || parsed["gallery"].length === 0 || parsed["gallery"].length > MAX_PHOTOS) return err("content-invalid");
  const { notice, gallery, testimonials, launch: _launch, serviceArea: _area, ...extra } = parsed;
  const seen = new Set<string>();
  const photos: Photo[] = [];
  for (const item of gallery as unknown[]) {
    if (!isRecord(item)) return err("content-invalid");
    const { id, src, alt, title, caption, ...rest } = item;
    if (!isPhotoSrc(text(src)) || seen.has(text(src))) return err("content-invalid");
    seen.add(text(src));
    const known = parseId(text(id));
    photos.push({ id: known.ok && !photos.some((one) => one.id === known.value) ? known.value : newId(), src: text(src), alt: line(text(alt)).slice(0, LIMITS.alt), title: line(text(title)).slice(0, LIMITS.title), caption: line(text(caption)).slice(0, LIMITS.caption), extra: rest });
  }
  const reviews: Review[] = [];
  if (testimonials !== undefined) {
    if (!Array.isArray(testimonials) || testimonials.length > MAX_REVIEWS) return err("content-invalid");
    for (const item of testimonials as unknown[]) {
      if (!isRecord(item) || !prose(text(item["quote"])) || !line(text(item["by"]))) return err("content-invalid");
      reviews.push({ quote: prose(text(item["quote"])).slice(0, LIMITS.quote), by: line(text(item["by"])).slice(0, LIMITS.by) });
    }
  }
  return ok({ notice: line(text(notice)).slice(0, LIMITS.notice), gallery: photos, reviews, extra });
}

/**
 * The content as the site's file: what `readContent` reads back unchanged.
 * `blocks` are the site's status and service area, when the file is being
 * written for the site and not only compared.
 */
export function writeContent(content: SiteContent, blocks: { readonly launch?: Record<string, unknown>; readonly serviceArea?: Record<string, unknown> | null } = {}): string {
  const written = { ...(blocks.launch ? { launch: blocks.launch } : {}), ...(blocks.serviceArea ? { serviceArea: blocks.serviceArea } : {}) };
  if (content.noGallery) return `${JSON.stringify({ ...content.extra, ...written }, null, 2)}\n`;
  const file = {
    ...content.extra,
    ...written,
    notice: content.notice,
    gallery: content.gallery.map((photo) => ({ id: photo.id, src: photo.src, alt: photo.alt, title: photo.title, ...(photo.caption ? { caption: photo.caption } : {}), ...photo.extra })),
    testimonials: content.reviews.map((review) => ({ quote: review.quote, by: review.by })),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

// ── What changed ─────────────────────────────────────────────────────────

const short = (words: string, most = 80) => (words.length > most ? `${words.slice(0, most - 1)}…` : words);

/** The differences between what is on the site and a set of changes, as sentences a person can check. */
export function changesBetween(live: SiteContent, next: SiteContent): string[] {
  const out: string[] = [];
  const before = new Map(live.gallery.map((photo) => [photo.id, photo]));
  const after = new Map(next.gallery.map((photo) => [photo.id, photo]));
  for (const photo of next.gallery) if (!before.has(photo.id)) out.push(`New photo: ${photo.title}`);
  for (const photo of live.gallery) if (!after.has(photo.id)) out.push(`Photo removed: ${photo.title}`);
  for (const photo of next.gallery) {
    const was = before.get(photo.id);
    if (was && (was.title !== photo.title || was.alt !== photo.alt || was.caption !== photo.caption)) out.push(`Words changed on a photo: ${photo.title}`);
  }
  const kept = (list: readonly Photo[], other: ReadonlyMap<Id, Photo>) => list.filter((photo) => other.has(photo.id)).map((photo) => photo.id).join(" ");
  if (kept(live.gallery, after) !== kept(next.gallery, before)) out.push("Photos put in a new order");
  // The first photo is the one shown largest, so a new first photo is worth saying even when the rest kept their order.
  else if (next.gallery[0] && live.gallery[0] && next.gallery[0].id !== live.gallery[0].id) out.push("A different photo comes first");
  if (live.notice !== next.notice) out.push(next.notice ? `Notice: “${short(next.notice, 120)}”` : "Notice taken down");
  const same = (a: Review, b: Review) => a.quote === b.quote && a.by === b.by;
  for (const review of next.reviews) if (!live.reviews.some((one) => same(one, review))) out.push(`New review from ${review.by}`);
  for (const review of live.reviews) if (!next.reviews.some((one) => same(one, review))) out.push(`Review removed: ${review.by}`);
  return out;
}

export const sameContent = (a: SiteContent, b: SiteContent): boolean => writeContent(a) === writeContent(b);
