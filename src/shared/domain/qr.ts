// A QR code (ISO/IEC 18004) for short text, such as the link an
// authenticator app scans. Byte mode, error correction level M, versions 1
// to 10: up to 213 bytes. No package: the arithmetic is small and fixed.

/** Error correction codewords per block, and the blocks' data codeword counts, level M. */
const LEVEL_M: readonly { readonly ec: number; readonly blocks: readonly number[] }[] = [
  { ec: 10, blocks: [16] },
  { ec: 16, blocks: [28] },
  { ec: 26, blocks: [44] },
  { ec: 18, blocks: [32, 32] },
  { ec: 24, blocks: [43, 43] },
  { ec: 16, blocks: [27, 27, 27, 27] },
  { ec: 18, blocks: [31, 31, 31, 31] },
  { ec: 22, blocks: [38, 38, 39, 39] },
  { ec: 22, blocks: [36, 36, 36, 37, 37] },
  { ec: 26, blocks: [43, 43, 43, 43, 44] },
];

const ALIGNMENT: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

/** The modules, true for dark, row by row. Null when the text is too long. */
export type QrCode = { readonly size: number; readonly version: number; readonly dark: readonly (readonly boolean[])[] };

export function qrCode(text: string): QrCode | null {
  const bytes = [...new TextEncoder().encode(text)];
  const version = LEVEL_M.findIndex((level, index) => capacityBits(index + 1, level) >= 4 + countBits(index + 1) + bytes.length * 8) + 1;
  if (version === 0) return null;
  const level = LEVEL_M[version - 1] as (typeof LEVEL_M)[number];
  const codewords = interleave(level, dataCodewords(bytes, version, level));

  const size = version * 4 + 17;
  const grid = new Grid(size);
  drawFunctionPatterns(grid, version);
  placeData(grid, codewords);

  let best: { mask: number; score: number; dark: boolean[][] } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const trial = grid.copy();
    trial.applyMask(mask);
    drawFormat(trial, mask);
    const score = penalty(trial.dark);
    if (!best || score < best.score) best = { mask, score, dark: trial.dark };
  }
  return { size, version, dark: (best as { dark: boolean[][] }).dark };
}

/** The code as an SVG picture, dark on light with a quiet zone of four modules. */
export function qrSvg(code: QrCode, label: string): string {
  const quiet = 4;
  const whole = code.size + quiet * 2;
  let path = "";
  code.dark.forEach((row, y) => row.forEach((dark, x) => (path += dark ? `M${x + quiet} ${y + quiet}h1v1h-1z` : "")));
  const safe = label.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${whole} ${whole}" role="img" aria-label="${safe}" shape-rendering="crispEdges"><rect width="${whole}" height="${whole}" fill="#fff"/><path fill="#000" d="${path}"/></svg>`;
}

const countBits = (version: number) => (version < 10 ? 8 : 16);
const capacityBits = (_version: number, level: (typeof LEVEL_M)[number]) => level.blocks.reduce((sum, n) => sum + n, 0) * 8;

function dataCodewords(bytes: readonly number[], version: number, level: (typeof LEVEL_M)[number]): number[] {
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4); // byte mode
  put(bytes.length, countBits(version));
  for (const byte of bytes) put(byte, 8);
  const capacity = capacityBits(version, level);
  put(0, Math.min(4, capacity - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
  for (let pad = 0xec; words.length < capacity / 8; pad ^= 0xec ^ 0x11) words.push(pad);
  return words;
}

function interleave(level: (typeof LEVEL_M)[number], data: readonly number[]): number[] {
  const divisor = rsDivisor(level.ec);
  const blocks: number[][] = [];
  const ecs: number[][] = [];
  let at = 0;
  for (const length of level.blocks) {
    const block = data.slice(at, at + length);
    at += length;
    blocks.push(block);
    ecs.push(rsRemainder(block, divisor));
  }
  const out: number[] = [];
  const longest = Math.max(...level.blocks);
  for (let i = 0; i < longest; i++) for (const block of blocks) if (i < block.length) out.push(block[i] as number);
  for (let i = 0; i < level.ec; i++) for (const ec of ecs) out.push(ec[i] as number);
  return out;
}

// Reed-Solomon over GF(2^8) with the polynomial 0x11D.
function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j] as number, root);
      if (j + 1 < degree) result[j] = (result[j] as number) ^ (result[j + 1] as number);
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coefficient, i) => (result[i] = (result[i] as number) ^ gfMultiply(coefficient, factor)));
  }
  return result;
}

class Grid {
  readonly size: number;
  readonly dark: boolean[][];
  readonly fixed: boolean[][];
  constructor(size: number, dark?: boolean[][], fixed?: boolean[][]) {
    this.size = size;
    this.dark = dark ?? Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.fixed = fixed ?? Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  set(x: number, y: number, dark: boolean): void {
    (this.dark[y] as boolean[])[x] = dark;
    (this.fixed[y] as boolean[])[x] = true;
  }
  copy(): Grid {
    return new Grid(this.size, this.dark.map((row) => [...row]), this.fixed);
  }
  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if ((this.fixed[y] as boolean[])[x]) continue;
        const flip = [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0, (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mask];
        if (flip) (this.dark[y] as boolean[])[x] = !(this.dark[y] as boolean[])[x];
      }
    }
  }
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.size;
  for (let i = 0; i < size; i++) {
    grid.set(6, i, i % 2 === 0);
    grid.set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        grid.set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  const centers = ALIGNMENT[version - 1] as readonly number[];
  const last = centers.length - 1;
  centers.forEach((cy, i) =>
    centers.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) grid.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  drawFormat(grid, 0); // reserves the format areas; drawn again for the chosen mask
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      grid.set(a, b, dark);
      grid.set(b, a, dark);
    }
  }
}

function drawFormat(grid: Grid, mask: number): void {
  const size = grid.size;
  const data = (0b00 << 3) | mask; // level M is 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) grid.set(8, i, bit(i));
  grid.set(8, 7, bit(6));
  grid.set(8, 8, bit(7));
  grid.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) grid.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) grid.set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) grid.set(8, size - 15 + i, bit(i));
  grid.set(8, size - 8, true); // the dark module
}

function placeData(grid: Grid, codewords: readonly number[]): void {
  const size = grid.size;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if ((grid.fixed[y] as boolean[])[x]) continue;
        if (i < codewords.length * 8) (grid.dark[y] as boolean[])[x] = (((codewords[i >>> 3] as number) >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
}

/** The standard's penalty score; the mask with the lowest is used. */
function penalty(dark: readonly (readonly boolean[])[]): number {
  const size = dark.length;
  const at = (x: number, y: number) => (dark[y] as readonly boolean[])[x] as boolean;
  let score = 0;
  const lines = (get: (a: number, b: number) => boolean) => {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b <= size; b++) {
        if (b < size && get(a, b) === get(a, b - 1)) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      const pattern = [true, false, true, true, true, false, true];
      for (let b = 0; b + 7 <= size; b++) {
        if (!pattern.every((dark, k) => get(a, b + k) === dark)) continue;
        const before = b >= 4 && [1, 2, 3, 4].every((k) => !get(a, b - k));
        const after = b + 11 <= size && [7, 8, 9, 10].every((k) => !get(a, b + k));
        const edgeBefore = b < 4 && Array.from({ length: b }, (_, k) => k).every((k) => !get(a, k));
        const edgeAfter = b + 11 > size && Array.from({ length: size - b - 7 }, (_, k) => b + 7 + k).every((k) => !get(a, k));
        if (before || after || edgeBefore || edgeAfter) score += 40;
      }
    }
  };
  lines((y, x) => at(x, y));
  lines((x, y) => at(x, y));
  for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) if (at(x, y) === at(x + 1, y) && at(x, y) === at(x, y + 1) && at(x, y) === at(x + 1, y + 1)) score += 3;
  const darkCount = dark.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  score += Math.floor(Math.abs(darkCount * 20 - size * size * 10) / (size * size)) * 10;
  return score;
}
