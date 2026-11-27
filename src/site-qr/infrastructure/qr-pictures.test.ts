import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { test } from "node:test";
import { decodeFrame, symbologyQrPictures } from "./qr-pictures.ts";

/** Reads a one-bit grayscale PNG from pngOf back into pixels. */
function pixels(png: Uint8Array): { width: number; height: number; luma: Uint8Array } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  let at = 8;
  const idat: Uint8Array[] = [];
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = new TextDecoder().decode(png.subarray(at + 4, at + 8));
    if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rowBytes = Math.ceil(width / 8);
  const luma = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) luma[y * width + x] = (raw[y * (rowBytes + 1) + 1 + (x >> 3)] as number) & (0x80 >> (x & 7)) ? 255 : 0;
  return { width, height, luma };
}

test("the PNG is a real PNG, at least 1,200 pixels square, that scans back to the address", () => {
  const address = "https://betterdaystowing.com/?ref=card-spring";
  const png = symbologyQrPictures.png(address);
  assert.ok(png);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const frame = pixels(png);
  assert.equal(frame.width, frame.height);
  assert.ok(frame.width >= 1200);
  // A smaller copy, as a camera would see it, keeps the decoder quick.
  const step = Math.floor(frame.width / 300);
  const small = { width: Math.floor(frame.width / step), height: Math.floor(frame.height / step), luma: new Uint8Array(Math.floor(frame.width / step) ** 2) };
  for (let y = 0; y < small.height; y++) for (let x = 0; x < small.width; x++) small.luma[y * small.width + x] = frame.luma[y * step * frame.width + x * step] as number;
  assert.equal(decodeFrame(small), address);
});

test("the SVG names itself for screen readers", () => {
  assert.match(symbologyQrPictures.svg("https://example.com/?ref=a1", "QR code for Flyers") ?? "", /QR code for Flyers/);
  assert.equal(symbologyQrPictures.png(""), null);
});
