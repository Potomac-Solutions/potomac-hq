// QR pictures for a client's codes (decision 0024), drawn by symbology like
// referral links' are: an SVG, sharp at any size, and a PNG for print shops
// that won't take one. The PNG is a plain black-and-white image, 1,200
// pixels square or a little more, with a quiet zone of four modules.
import { deflateSync } from "node:zlib";
import { loadQr, QrError, type Code } from "@journey-to-code/symbology";
import type { QrPictures } from "../application/ports.ts";

const qr = await loadQr();
const QUIET = 4;
const TARGET = 1200;

/** The code, or null when the text is too long or empty. Anything else is a fault. */
function encode(text: string): Code | null {
  try {
    return qr.encode(text);
  } catch (error) {
    if (error instanceof QrError && (error.code === "too-long" || error.code === "empty")) return null;
    throw error;
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A one-bit grayscale PNG of the code: dark modules black, the rest white. */
export function pngOf(code: Code): Uint8Array {
  const modules = code.size + QUIET * 2;
  const scale = Math.max(1, Math.ceil(TARGET / modules));
  const side = modules * scale;
  const rowBytes = Math.ceil(side / 8);
  const raw = new Uint8Array((rowBytes + 1) * side);
  for (let y = 0; y < side; y++) {
    const my = Math.floor(y / scale) - QUIET;
    const row = y * (rowBytes + 1);
    raw[row] = 0; // no filter
    for (let x = 0; x < side; x++) {
      const mx = Math.floor(x / scale) - QUIET;
      const dark = mx >= 0 && my >= 0 && mx < code.size && my < code.size && code.modules[my * code.size + mx] === 1;
      // In one-bit grayscale, 1 is white.
      if (!dark) raw[row + 1 + (x >> 3)] = (raw[row + 1 + (x >> 3)] as number) | (0x80 >> (x & 7));
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, side);
  view.setUint32(4, side);
  header.set([1, 0, 0, 0, 0], 8); // bit depth 1, grayscale, deflate, no filter, no interlace
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export const symbologyQrPictures: QrPictures = {
  svg(text, title) {
    const code = encode(text);
    return code ? qr.svg(code, { title }) : null;
  },
  png(text) {
    const code = encode(text);
    return code ? pngOf(code) : null;
  },
};

/** For tests: reads a code back from a grayscale frame. */
export const decodeFrame = (frame: { width: number; height: number; luma: Uint8Array }): string => qr.decodeText(frame);
