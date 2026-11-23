import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { checkPhoto, contentTypeOf, MAX_PHOTO_BYTES, photoFileName } from "./photo.ts";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

test("a photo is a JPEG, PNG or WebP by its first bytes, whatever it is called", () => {
  assert.deepEqual(checkPhoto(jpeg), { ok: true, value: { extension: "jpg", contentType: "image/jpeg" } });
  assert.deepEqual(checkPhoto(png), { ok: true, value: { extension: "png", contentType: "image/png" } });
  assert.deepEqual(checkPhoto(webp), { ok: true, value: { extension: "webp", contentType: "image/webp" } });
  assert.deepEqual(checkPhoto(new TextEncoder().encode("<svg onload=alert(1)>")), { ok: false, error: "photo-not-a-photo" });
  assert.deepEqual(checkPhoto(new TextEncoder().encode("%PDF-1.7")), { ok: false, error: "photo-not-a-photo" });
  assert.deepEqual(checkPhoto(new Uint8Array(0)), { ok: false, error: "photo-missing" });
  assert.deepEqual(checkPhoto(null), { ok: false, error: "photo-missing" });
});

test("a photo over the limit is refused: it has not been shrunk for the web", () => {
  const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
  big.set(jpeg);
  assert.deepEqual(checkPhoto(big), { ok: false, error: "photo-too-large" });
  assert.equal(checkPhoto(big.subarray(0, MAX_PHOTO_BYTES)).ok, true);
});

test("a new photo's file name comes from its id, and a photo's type from its name", () => {
  assert.equal(photoFileName("0190a000-1234-7000-8000-000000000001" as Id, { extension: "jpg", contentType: "image/jpeg" }), "hq-0190a0001234.jpg");
  assert.equal(contentTypeOf("public/gallery/booth.WEBP"), "image/webp");
  assert.equal(contentTypeOf("public/gallery/booth.jpeg"), "image/jpeg");
  assert.equal(contentTypeOf("public/gallery/booth"), "application/octet-stream");
});
