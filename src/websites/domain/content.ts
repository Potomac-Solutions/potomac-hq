// What a client may change on their own website: the photo gallery, a short
// notice, customer reviews, and, on a site that shows them, before-and-after
// pairs of photos. The rules here decide what a change may be.
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

/** One side of a before-and-after pair. */
export type PairPhoto = {
  readonly id: Id;
  readonly src: string;
  readonly alt: string;
  /** Fields of the site's own, such as `srcSet` or `focus`. */
  readonly extra: Extra;
};

/** The same job photographed before and after: a repair, a clean-up, a remodel. */
export type Pair = {
  readonly id: Id;
  /** What it is, like the vehicle: Ford F-250 Super Duty. */
  readonly title: string;
  /** What was done, like Front bumper and fender. */
  readonly caption: string;
  readonly before: PairPhoto;
  readonly after: PairPhoto;
  readonly extra: Extra;
};

export type Stage = "before" | "after";
export const STAGES: readonly Stage[] = ["before", "after"];

export type SiteContent = {
  /** True for a site whose file has no gallery: it has no photos, notice or reviews to change. */
  readonly noGallery?: true;
  /** One short line shown at the top of the site. Empty for none. */
  readonly notice: string;
  readonly gallery: readonly Photo[];
  readonly reviews: readonly Review[];
  /** Before-and-after pairs, in the order shown. Missing for a site that doesn't show them. */
  readonly pairs?: readonly Pair[];
  readonly extra: Extra;
};

export const MAX_PHOTOS = 30;
export const MAX_REVIEWS = 12;
export const MAX_PAIRS = 20;
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
  | "before-alt-missing"
  | "before-alt-too-long"
  | "after-alt-missing"
  | "after-alt-too-long"
  | "too-many-pairs"
  | "no-such-pair"
  | "no-pairs"
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

/** A list with one item moved; null when it can't move that way. */
function moved<T extends { readonly id: Id }>(list: readonly T[], from: number, move: Move): T[] | null {
  const to = move === "first" ? 0 : move === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= list.length || to === from) return null;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function withPhotoMoved(content: SiteContent, id: Id, move: Move): Result<SiteContent, ContentError> {
  const from = content.gallery.findIndex((one) => one.id === id);
  if (from < 0) return err("no-such-photo");
  const gallery = moved(content.gallery, from, move);
  return gallery ? ok({ ...content, gallery }) : err("unchanged");
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

// ── Before and after ─────────────────────────────────────────────────────

/** True when the site shows before-and-after pairs, even if it has none right now. */
export const hasPairs = (content: SiteContent): boolean => content.pairs !== undefined;

export type PairWords = { readonly title: string; readonly caption?: string | null; readonly beforeAlt: string; readonly afterAlt: string };

export function pairWords(input: PairWords): Result<{ title: string; caption: string; beforeAlt: string; afterAlt: string }, ContentError> {
  const title = line(input.title);
  if (!title) return err("title-missing");
  if (title.length > LIMITS.title) return err("title-too-long");
  const caption = line(input.caption);
  if (caption.length > LIMITS.caption) return err("caption-too-long");
  const beforeAlt = line(input.beforeAlt);
  if (!beforeAlt) return err("before-alt-missing");
  if (beforeAlt.length > LIMITS.alt) return err("before-alt-too-long");
  const afterAlt = line(input.afterAlt);
  if (!afterAlt) return err("after-alt-missing");
  if (afterAlt.length > LIMITS.alt) return err("after-alt-too-long");
  return ok({ title, caption, beforeAlt, afterAlt });
}

/** Adds a pair at the end. */
export function withPair(content: SiteContent, ids: { readonly id: Id; readonly before: { readonly id: Id; readonly src: string }; readonly after: { readonly id: Id; readonly src: string } }, input: PairWords): Result<SiteContent, ContentError> {
  if (!content.pairs) return err("no-pairs");
  if (content.pairs.length >= MAX_PAIRS) return err("too-many-pairs");
  const words = pairWords(input);
  if (!words.ok) return words;
  const pair: Pair = { id: ids.id, title: words.value.title, caption: words.value.caption, before: { ...ids.before, alt: words.value.beforeAlt, extra: {} }, after: { ...ids.after, alt: words.value.afterAlt, extra: {} }, extra: {} };
  return ok({ ...content, pairs: [...content.pairs, pair] });
}

export function withPairWords(content: SiteContent, id: Id, input: PairWords): Result<SiteContent, ContentError> {
  const found = content.pairs?.find((one) => one.id === id);
  if (!content.pairs || !found) return err("no-such-pair");
  const words = pairWords(input);
  if (!words.ok) return words;
  const { title, caption, beforeAlt, afterAlt } = words.value;
  if (title === found.title && caption === found.caption && beforeAlt === found.before.alt && afterAlt === found.after.alt) return err("unchanged");
  return ok({ ...content, pairs: content.pairs.map((one) => (one.id === id ? { ...one, title, caption, before: { ...one.before, alt: beforeAlt }, after: { ...one.after, alt: afterAlt } } : one)) });
}

/** Unlike the gallery, the last pair may go: the site then hides the section. */
export function withoutPair(content: SiteContent, id: Id): Result<SiteContent, ContentError> {
  if (!content.pairs?.some((one) => one.id === id)) return err("no-such-pair");
  return ok({ ...content, pairs: content.pairs.filter((one) => one.id !== id) });
}

export function withPairMoved(content: SiteContent, id: Id, move: Move): Result<SiteContent, ContentError> {
  const from = content.pairs?.findIndex((one) => one.id === id) ?? -1;
  if (!content.pairs || from < 0) return err("no-such-pair");
  const pairs = moved(content.pairs, from, move);
  return pairs ? ok({ ...content, pairs }) : err("unchanged");
}

/** Every photo the content shows, gallery and pairs alike, each with its file. */
export function photosOf(content: SiteContent): { readonly id: Id; readonly src: string }[] {
  return [...content.gallery, ...(content.pairs ?? []).flatMap((pair) => [pair.before, pair.after])].map(({ id, src }) => ({ id, src }));
}

/** The content with every photo's id passed through `rename`: for ids that belong to another site. */
export function withPhotoIds(content: SiteContent, rename: (id: Id) => Id): SiteContent {
  const side = (photo: PairPhoto): PairPhoto => ({ ...photo, id: rename(photo.id) });
  return { ...content, gallery: content.gallery.map((photo) => ({ ...photo, id: rename(photo.id) })), ...(content.pairs ? { pairs: content.pairs.map((pair) => ({ ...pair, before: side(pair.before), after: side(pair.after) })) } : {}) };
}

/**
 * The other sizes of a pair's photo named in its `srcSet`, like
 * `/gallery/a-480.webp 480w`: files of the site's own that HQ never holds,
 * but that should go when the pair does. Never its own `src`.
 */
export function otherSizes(photo: PairPhoto): string[] {
  const set = photo.extra["srcSet"];
  if (typeof set !== "string") return [];
  return set
    .split(",")
    .map((entry) => entry.trim().split(/\s+/)[0] ?? "")
    .filter((src, at, all) => isPhotoSrc(src) && src !== photo.src && all.indexOf(src) === at);
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
  const { notice, gallery, testimonials, beforeAfter, launch: _launch, serviceArea: _area, ...extra } = parsed;
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
  let pairs: Pair[] | undefined;
  if (beforeAfter !== undefined) {
    if (!Array.isArray(beforeAfter) || beforeAfter.length > MAX_PAIRS) return err("content-invalid");
    pairs = [];
    const taken = new Set(photos.map((photo) => photo.id));
    const idFor = (value: unknown) => {
      const known = parseId(text(value));
      const id = known.ok && !taken.has(known.value) ? known.value : newId();
      taken.add(id);
      return id;
    };
    const side = (value: unknown): PairPhoto | null => {
      if (!isRecord(value)) return null;
      const { id, src, alt, ...rest } = value;
      if (!isPhotoSrc(text(src)) || seen.has(text(src))) return null;
      seen.add(text(src));
      return { id: idFor(id), src: text(src), alt: line(text(alt)).slice(0, LIMITS.alt), extra: rest };
    };
    for (const item of beforeAfter as unknown[]) {
      if (!isRecord(item)) return err("content-invalid");
      const { id, title, caption, before: was, after: now, ...rest } = item;
      const pairId = idFor(id);
      const before = side(was);
      const after = side(now);
      if (!before || !after) return err("content-invalid");
      pairs.push({ id: pairId, title: line(text(title)).slice(0, LIMITS.title), caption: line(text(caption)).slice(0, LIMITS.caption), before, after, extra: rest });
    }
  }
  return ok({ notice: line(text(notice)).slice(0, LIMITS.notice), gallery: photos, reviews, ...(pairs ? { pairs } : {}), extra });
}

/**
 * The content as the site's file: what `readContent` reads back unchanged.
 * `blocks` are the site's status and service area, when the file is being
 * written for the site and not only compared.
 */
const writtenSide = (photo: PairPhoto) => ({ id: photo.id, src: photo.src, alt: photo.alt, ...photo.extra });

export function writeContent(content: SiteContent, blocks: { readonly launch?: Record<string, unknown>; readonly serviceArea?: Record<string, unknown> | null } = {}): string {
  const written = { ...(blocks.launch ? { launch: blocks.launch } : {}), ...(blocks.serviceArea ? { serviceArea: blocks.serviceArea } : {}) };
  if (content.noGallery) return `${JSON.stringify({ ...content.extra, ...written }, null, 2)}\n`;
  const file = {
    ...content.extra,
    ...written,
    notice: content.notice,
    gallery: content.gallery.map((photo) => ({ id: photo.id, src: photo.src, alt: photo.alt, title: photo.title, ...(photo.caption ? { caption: photo.caption } : {}), ...photo.extra })),
    ...(content.pairs ? { beforeAfter: content.pairs.map((pair) => ({ id: pair.id, title: pair.title, ...(pair.caption ? { caption: pair.caption } : {}), before: writtenSide(pair.before), after: writtenSide(pair.after), ...pair.extra })) } : {}),
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
  const was = new Map((live.pairs ?? []).map((pair) => [pair.id, pair]));
  const now = new Map((next.pairs ?? []).map((pair) => [pair.id, pair]));
  for (const pair of next.pairs ?? []) if (!was.has(pair.id)) out.push(`New before and after: ${pair.title}`);
  for (const pair of live.pairs ?? []) if (!now.has(pair.id)) out.push(`Before and after removed: ${pair.title}`);
  for (const pair of next.pairs ?? []) {
    const old = was.get(pair.id);
    if (old && (old.title !== pair.title || old.caption !== pair.caption || old.before.alt !== pair.before.alt || old.after.alt !== pair.after.alt)) out.push(`Words changed on a before and after: ${pair.title}`);
  }
  const order = (list: readonly Pair[], other: ReadonlyMap<Id, Pair>) => list.filter((pair) => other.has(pair.id)).map((pair) => pair.id).join(" ");
  if (order(live.pairs ?? [], now) !== order(next.pairs ?? [], was)) out.push("Before and after put in a new order");
  else if (next.pairs?.[0] && live.pairs?.[0] && next.pairs[0].id !== live.pairs[0].id) out.push("A different before and after comes first");
  if (live.notice !== next.notice) out.push(next.notice ? `Notice: “${short(next.notice, 120)}”` : "Notice taken down");
  const same = (a: Review, b: Review) => a.quote === b.quote && a.by === b.by;
  for (const review of next.reviews) if (!live.reviews.some((one) => same(one, review))) out.push(`New review from ${review.by}`);
  for (const review of live.reviews) if (!next.reviews.some((one) => same(one, review))) out.push(`Review removed: ${review.by}`);
  return out;
}

export const sameContent = (a: SiteContent, b: SiteContent): boolean => writeContent(a) === writeContent(b);
