// Photos and a logo uploaded to a build (decision 0010, slice 2). Decided by
// their first bytes, never by what the browser says. The upload form shrinks
// them first, so one this size is already fit for a web page. Claude is told
// each one's path, size and what it shows, never the picture itself.
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_IMAGES = 30;
export const MAX_ALT = 200;

export const IMAGE_KINDS = ["photo", "logo"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

export type ImageType = { readonly extension: "jpg" | "png" | "webp"; readonly contentType: string };
export type ImageError = "image-missing" | "image-too-large" | "image-not-a-picture" | "kind-invalid" | "alt-missing" | "alt-too-long" | "too-many-images";

export type BuildImage = {
  readonly id: Id;
  readonly buildId: Id;
  /** Where it is in the site, like images/photo-0190a0001234.jpg. */
  readonly path: string;
  readonly kind: ImageKind;
  readonly contentType: string;
  readonly width: number;
  readonly height: number;
  /** What it shows: its alt text on the site. */
  readonly alt: string;
  readonly bytes: number;
  readonly addedBy: Id;
  readonly createdAt: string;
};

const starts = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean => signature.every((byte, i) => bytes[at + i] === byte);

export function imageType(bytes: Uint8Array | null | undefined): Result<ImageType, ImageError> {
  if (!bytes || bytes.length === 0) return err("image-missing");
  if (bytes.length > MAX_IMAGE_BYTES) return err("image-too-large");
  if (starts(bytes, [0xff, 0xd8, 0xff])) return ok({ extension: "jpg", contentType: "image/jpeg" });
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ok({ extension: "png", contentType: "image/png" });
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return ok({ extension: "webp", contentType: "image/webp" });
  return err("image-not-a-picture");
}

const u16be = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u16le = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, at: number) => u16le(b, at) | ((b[at + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, at: number) => ((b[at] ?? 0) * 2 ** 24) + ((b[at + 1] ?? 0) << 16) + ((b[at + 2] ?? 0) << 8) + (b[at + 3] ?? 0);

/** Width and height read from the file's own header, or null when it can't be read. */
export function imageSize(bytes: Uint8Array, type: ImageType): { readonly width: number; readonly height: number } | null {
  if (type.extension === "png") return bytes.length >= 24 ? { width: u32be(bytes, 16), height: u32be(bytes, 20) } : null;
  if (type.extension === "webp") {
    if (starts(bytes, [0x56, 0x50, 0x38, 0x20], 12)) return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    if (starts(bytes, [0x56, 0x50, 0x38, 0x4c], 12)) {
      const bits = (bytes[21] ?? 0) | ((bytes[22] ?? 0) << 8) | ((bytes[23] ?? 0) << 16) | ((bytes[24] ?? 0) << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (starts(bytes, [0x56, 0x50, 0x38, 0x58], 12)) return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
    return null;
  }
  // JPEG: walk the markers to the first start-of-frame.
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      at += marker === 0xff ? 1 : 2;
      continue;
    }
    const length = u16be(bytes, at + 2);
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { width: u16be(bytes, at + 7), height: u16be(bytes, at + 5) };
    }
    at += 2 + length;
  }
  return null;
}

/** Checks an upload: a picture HQ can read, of a known kind, with what it shows. */
export function checkImage(input: { readonly kind: string; readonly alt: string; readonly bytes: Uint8Array | null }, existing: number): Result<{ readonly kind: ImageKind; readonly alt: string; readonly type: ImageType; readonly width: number; readonly height: number }, ImageError> {
  if (existing >= MAX_IMAGES) return err("too-many-images");
  if (!(IMAGE_KINDS as readonly string[]).includes(input.kind)) return err("kind-invalid");
  const alt = input.alt.replace(/\s+/g, " ").trim();
  if (!alt) return err("alt-missing");
  if (alt.length > MAX_ALT) return err("alt-too-long");
  const type = imageType(input.bytes);
  if (!type.ok) return type;
  const size = imageSize(input.bytes as Uint8Array, type.value);
  if (!size || size.width < 1 || size.height < 1) return err("image-not-a-picture");
  return ok({ kind: input.kind as ImageKind, alt, type: type.value, ...size });
}

/** Its path in the site: from its id, so no two clash and nothing typed reaches a path. */
export const imagePath = (id: Id, kind: ImageKind, type: ImageType): string => `images/${kind}-${id.replaceAll("-", "").slice(-12)}.${type.extension}`;

/** Whether a path in the site is one of a build's images. */
export const isImagePath = (path: string): boolean => /^images\/(photo|logo)-[0-9a-f]{12}\.(jpg|png|webp)$/.test(path);
