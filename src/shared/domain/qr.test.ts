import assert from "node:assert/strict";
import { test } from "node:test";
import { qrCode, qrSvg } from "./qr.ts";

const row = (code: NonNullable<ReturnType<typeof qrCode>>, y: number) => code.dark[y]?.map((d) => (d ? "#" : ".")).join("") ?? "";

test("the smallest version that holds the text is used, up to version 10", () => {
  assert.equal(qrCode("HQ")?.version, 1);
  assert.equal(qrCode("x".repeat(14))?.version, 1);
  assert.equal(qrCode("x".repeat(15))?.version, 2);
  assert.equal(qrCode("x".repeat(213))?.version, 10);
  assert.equal(qrCode("x".repeat(214)), null, "too long");
  // HQ's two-factor links: version 7 for most emails, 8 for a long one.
  const link = (email: string) => `otpauth://totp/Potomac%20HQ%3A${encodeURIComponent(email)}?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Potomac%20HQ`;
  assert.equal(qrCode(link("mikey@example.com"))?.version, 7);
  assert.equal(qrCode(link("a.long.name@a-long-company-name.com"))?.version, 8);
});

test("the finder patterns, timing pattern and dark module are where scanners look", () => {
  const code = qrCode("Potomac HQ") as NonNullable<ReturnType<typeof qrCode>>;
  assert.equal(code.size, 21);
  assert.equal(row(code, 0).slice(0, 8), "#######.");
  assert.equal(row(code, 0).slice(13), ".#######");
  assert.equal(row(code, 2).slice(0, 7), "#.###.#");
  assert.equal(row(code, 6).slice(8, 13), "#.#.#", "timing");
  assert.equal(code.dark[code.size - 8]?.[8], true, "the dark module");
});

test("the format bits say level M and are the same in both copies", () => {
  for (const text of ["a", "Potomac HQ", "x".repeat(100)]) {
    const code = qrCode(text) as NonNullable<ReturnType<typeof qrCode>>;
    const n = code.size;
    const bit = (x: number, y: number) => (code.dark[y]?.[x] ? 1 : 0);
    const first = [0, 1, 2, 3, 4, 5, 7, 8].map((y) => bit(8, y)).concat([7, 5, 4, 3, 2, 1, 0].map((x) => bit(x, 8)));
    const second = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => bit(n - 1 - i, 8)).concat([8, 9, 10, 11, 12, 13, 14].map((i) => bit(8, n - 15 + i)));
    assert.deepEqual(first, second, text);
    const value = first.reduce<number>((v, b, i) => v | (b << i), 0) ^ 0x5412;
    assert.equal(value >>> 13, 0b00, "level M");
  }
});

// Made by this encoder and decoded by OpenCV's QR reader when it was written.
// It catches any change to the output.
const GOLDEN = [
  "#######.#####.#######",
  "#.....#.#.##..#.....#",
  "#.###.#.###.#.#.###.#",
  "#.###.#..#.##.#.###.#",
  "#.###.#.##..#.#.###.#",
  "#.....#..#.##.#.....#",
  "#######.#.#.#.#######",
  "...........##........",
  "#..######...##..#.###",
  ".#.#.#.#..#.#.#..#...",
  "..###.#.###...##...##",
  ".##..#..##.#.#.#..#..",
  "#...#.#####..####..##",
  "........#.####..###.#",
  "#######.###.##..#.#..",
  "#.....#.###########..",
  "#.###.#.#.######.#...",
  "#.###.#.##.##........",
  "#.###.#..#....#.#..##",
  "#.....#...#..###.####",
  "#######.####.#.......",
];

test("the same text always makes the same code", () => {
  const code = qrCode("Potomac HQ") as NonNullable<ReturnType<typeof qrCode>>;
  assert.deepEqual(code.dark.map((_, y) => row(code, y)), GOLDEN);
  assert.deepEqual(qrCode("Potomac HQ"), code);
});

test("the picture has a quiet zone and a label, and escapes it", () => {
  const svg = qrSvg(qrCode("a") as NonNullable<ReturnType<typeof qrCode>>, `Scan "this" <now>`);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 29 29" role="img" aria-label="Scan &#34;this&#34; &#60;now&#62;"/);
  assert.match(svg, /<path fill="#000" d="M4 4h1v1h-1z/);
});
