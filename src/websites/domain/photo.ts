// A photo someone uploads for a website. Decided by its first bytes, never
// by what the browser says it is. Small enough to serve on a web page: the
// upload form shrinks a phone's photo before sending it.
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

/** A web photo this size has already been shrunk. A phone's original is larger, and is refused. */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

export type PhotoKind = { readonly extension: "jpg" | "png" | "webp"; readonly contentType: string };
export type PhotoError = "photo-missing" | "photo-too-large" | "photo-not-a-photo";

const starts = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean => signature.every((byte, i) => bytes[at + i] === byte);

export function checkPhoto(bytes: Uint8Array | null | undefined): Result<PhotoKind, PhotoError> {
  if (!bytes || bytes.length === 0) return err("photo-missing");
  if (bytes.length > MAX_PHOTO_BYTES) return err("photo-too-large");
  if (starts(bytes, [0xff, 0xd8, 0xff])) return ok({ extension: "jpg", contentType: "image/jpeg" });
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ok({ extension: "png", contentType: "image/png" });
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return ok({ extension: "webp", contentType: "image/webp" });
  return err("photo-not-a-photo");
}

/** The type a photo already on a site is served as, from its name. */
export function contentTypeOf(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif", gif: "image/gif" }[extension] ?? "application/octet-stream";
}

/** The file name a new photo gets on the site. From its id, so no two clash and nothing typed reaches a path. */
export const photoFileName = (id: Id, kind: PhotoKind): string => `hq-${id.replaceAll("-", "").slice(0, 12)}.${kind.extension}`;
