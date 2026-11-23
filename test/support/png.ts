// Makes a real PNG, so a browser test has a photo a browser can open.
import { crc32, deflateSync } from "node:zlib";

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A `width` × `height` picture: a gradient with a band across it, so shrinking it has something to keep. */
export function png(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits a channel, RGB
  const rows = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const start = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      const at = start + 1 + x * 3;
      const band = y > height * 0.4 && y < height * 0.6;
      rows[at] = band ? 200 : Math.floor((x / width) * 255);
      rows[at + 1] = band ? 30 : Math.floor((y / height) * 255);
      rows[at + 2] = band ? 30 : 120;
    }
  }
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A JPEG's width and height, read from its frame header. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2;
  while (at + 9 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] as number;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
    at += 2 + view.getUint16(at + 2);
  }
  return null;
}
