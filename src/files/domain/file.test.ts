import assert from "node:assert/strict";
import { test } from "node:test";
import { checkUpload, formatSize, MAX_FILE_BYTES } from "./file.ts";

const text = (value: string) => new TextEncoder().encode(value);
const pdf = text("%PDF-1.7 the rest");
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test("a file is typed by its name and must look like that type", () => {
  assert.deepEqual(checkUpload({ name: "Logo.PDF", bytes: pdf }), { ok: true, value: { name: "Logo.PDF", contentType: "application/pdf" } });
  assert.deepEqual(checkUpload({ name: "logo.png", bytes: png }), { ok: true, value: { name: "logo.png", contentType: "image/png" } });
  assert.deepEqual(checkUpload({ name: "logo.png", bytes: pdf }), { ok: false, error: "file-content-mismatch" });
  assert.deepEqual(checkUpload({ name: "notes.md", bytes: text("# Notes") }), { ok: true, value: { name: "notes.md", contentType: "text/plain; charset=utf-8" } });
});

test("types that a browser could run are refused", () => {
  for (const name of ["page.html", "art.svg", "run.exe", "script.js", "noextension", ".env"]) {
    assert.equal(checkUpload({ name, bytes: text("hello") }).ok, false, name);
  }
});

test("a text file with a NUL byte or broken UTF-8 is refused", () => {
  assert.deepEqual(checkUpload({ name: "a.txt", bytes: new Uint8Array([104, 0, 105]) }), { ok: false, error: "file-content-mismatch" });
  assert.deepEqual(checkUpload({ name: "a.csv", bytes: new Uint8Array([0xff, 0xfe, 0xfd]) }), { ok: false, error: "file-content-mismatch" });
});

test("folders in a name are dropped, and nothing is kept of a path", () => {
  assert.deepEqual(checkUpload({ name: "C:\\Users\\me\\..\\plan.pdf", bytes: pdf }), { ok: true, value: { name: "plan.pdf", contentType: "application/pdf" } });
  assert.deepEqual(checkUpload({ name: "../../etc/plan.pdf", bytes: pdf }), { ok: true, value: { name: "plan.pdf", contentType: "application/pdf" } });
  assert.deepEqual(checkUpload({ name: "a/", bytes: pdf }), { ok: false, error: "file-name-invalid" });
});

test("empty and oversized files are refused", () => {
  assert.deepEqual(checkUpload(null), { ok: false, error: "file-missing" });
  assert.deepEqual(checkUpload({ name: "a.pdf", bytes: new Uint8Array(0) }), { ok: false, error: "file-missing" });
  const big = new Uint8Array(MAX_FILE_BYTES + 1);
  big.set(pdf);
  assert.deepEqual(checkUpload({ name: "a.pdf", bytes: big }), { ok: false, error: "file-too-large" });
});

test("sizes read as people write them", () => {
  assert.equal(formatSize(512), "512 bytes");
  assert.equal(formatSize(640 * 1024), "640 KB");
  assert.equal(formatSize(12.3 * 1024 * 1024), "12.3 MB");
});
