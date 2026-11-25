// Small pure helpers: what kind of picture a receipt is, and a fingerprint of
// the records a draft was written from.
import type { Attachment } from "./prompts.ts";

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/** A receipt's picture or PDF by its first bytes, never its name. Null for anything else. */
export function receiptKind(bytes: Uint8Array): Attachment["mediaType"] | null {
  const starts = (...head: number[]) => head.every((byte, i) => bytes[i] === byte);
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (starts(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  return null;
}

export function base64Of(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** FNV-1a over the JSON of some facts: equal facts, equal fingerprint. */
export function fingerprintOf(facts: unknown): string {
  const text = JSON.stringify(facts);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
