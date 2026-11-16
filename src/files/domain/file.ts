// The file service's rules (roadmap, v0.3 and "File protection"): what may be
// uploaded, how big, and what a stored file's record holds. A file's type is
// decided here from its name and checked against its first bytes. What the
// browser says the type is never matters.
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type FileRecord = {
  readonly id: Id;
  readonly name: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  /** What the file is attached to, such as "deliverable". */
  readonly ownerType: string;
  readonly ownerId: Id;
  /** The client it belongs to, if any. */
  readonly organizationId: Id | null;
  /** Whether that client may download it. */
  readonly clientVisible: boolean;
  readonly uploadedBy: Id | null;
};

export type UploadError = "file-missing" | "file-too-large" | "file-name-invalid" | "file-type-not-allowed" | "file-content-mismatch";

const starts = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean => signature.every((byte, i) => bytes[at + i] === byte);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const isZip = (bytes: Uint8Array) => starts(bytes, ZIP);

/** Text has no NUL byte and is valid UTF-8. */
function isText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Extension → the type it is served as, and a check on the content. */
const TYPES: Readonly<Record<string, { readonly type: string; readonly looksRight: (bytes: Uint8Array) => boolean }>> = {
  pdf: { type: "application/pdf", looksRight: (b) => starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
  png: { type: "image/png", looksRight: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg: { type: "image/jpeg", looksRight: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  jpeg: { type: "image/jpeg", looksRight: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  gif: { type: "image/gif", looksRight: (b) => starts(b, [0x47, 0x49, 0x46, 0x38]) },
  webp: { type: "image/webp", looksRight: (b) => starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8) },
  txt: { type: "text/plain; charset=utf-8", looksRight: isText },
  md: { type: "text/plain; charset=utf-8", looksRight: isText },
  csv: { type: "text/csv; charset=utf-8", looksRight: isText },
  zip: { type: "application/zip", looksRight: isZip },
  docx: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", looksRight: isZip },
  xlsx: { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", looksRight: isZip },
  pptx: { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", looksRight: isZip },
};

export const ALLOWED_EXTENSIONS: readonly string[] = Object.keys(TYPES);

/**
 * Checks an upload. Answers with the name to keep (no folders, no control
 * characters) and the type to serve it as.
 */
export function checkUpload(upload: { readonly name: string; readonly bytes: Uint8Array } | null | undefined): Result<{ name: string; contentType: string }, UploadError> {
  if (!upload || upload.bytes.length === 0) return err("file-missing");
  if (upload.bytes.length > MAX_FILE_BYTES) return err("file-too-large");
  // Keep only the last path segment, whichever way the slashes lean.
  const base = (upload.name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (base.length === 0 || base.length > 200 || base.startsWith(".")) return err("file-name-invalid");
  const dot = base.lastIndexOf(".");
  const extension = dot < 1 ? "" : base.slice(dot + 1).toLowerCase();
  const known = Object.hasOwn(TYPES, extension) ? TYPES[extension] : undefined;
  if (!known) return err("file-type-not-allowed");
  if (!known.looksRight(upload.bytes)) return err("file-content-mismatch");
  return ok({ name: base, contentType: known.type });
}

/** "12.3 MB", "640 KB", "512 bytes". */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
