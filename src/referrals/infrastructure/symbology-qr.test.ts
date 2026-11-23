import assert from "node:assert/strict";
import { test } from "node:test";
import { loadQr } from "@journey-to-code/symbology";
import { symbologyQr } from "./symbology-qr.ts";

test("a short address becomes an SVG named for screen readers, with a quiet zone", () => {
  const svg = symbologyQr("https://hq.potomac.solutions/r/card", 'Cards & "flyers"');
  assert.ok(svg);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1" shape-rendering="crispEdges" role="img" aria-label="Cards &amp; &quot;flyers&quot;">/);
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#fff"\/><path fill="#000" d="M/);
  // 35 bytes fit version 3 (29 modules) at level M; four quiet modules on each side make 37.
  assert.match(svg, /viewBox="0 0 37 37"/);
});

test("the picture reads back as the address it was made from", async () => {
  const address = "https://hq.potomac.solutions/r/card";
  const svg = symbologyQr(address, "QR code");
  assert.ok(svg);
  // Paint the SVG's path into a grayscale frame, eight pixels a module, and read it with symbology's decoder.
  const side = Number(/viewBox="0 0 (\d+)/.exec(svg)?.[1]);
  const scale = 8;
  const luma = new Uint8Array(side * scale * side * scale).fill(255);
  for (const [, x, y, run] of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let dy = 0; dy < scale; dy++) luma.fill(0, (Number(y) * scale + dy) * side * scale + Number(x) * scale, (Number(y) * scale + dy) * side * scale + (Number(x) + Number(run)) * scale);
  }
  assert.equal((await loadQr()).decodeText({ width: side * scale, height: side * scale, luma }), address);
});

test("text too long for a code, or none at all, makes no picture", () => {
  assert.equal(symbologyQr(`https://hq.potomac.solutions/r/${"a".repeat(220)}`, "QR code"), null);
  assert.equal(symbologyQr("", "QR code"), null);
});
