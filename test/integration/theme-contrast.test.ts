// The Potomac theme's colour pairs, checked against WCAG 2.1 AA in both the
// light and the dark set: 4.5:1 for text, 3:1 for the edges of controls and
// for focus rings.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const css = readFileSync(join(import.meta.dirname, "..", "..", "src", "shared", "ui", "assets", "theme.css"), "utf8");

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `no ${selector} block`);
  const block = css.slice(start, css.indexOf("\n}", start));
  const found: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/g)) found[match[1] as string] = match[2] as string;
  return found;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT: [string, string][] = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["foreground", "muted"],
  // Links and link-style buttons are drawn in the primary colour.
  ["primary", "background"],
  ["primary", "card"],
  // Error text.
  ["destructive", "background"],
  ["destructive", "card"],
];
const EDGES: [string, string][] = [
  ["input", "background"],
  ["input", "card"],
  ["ring", "background"],
  ["ring", "card"],
];

for (const [name, selector] of [["light", ":root"], ["dark", ".dark"]] as const) {
  test(`${name} theme: text pairs reach 4.5:1`, () => {
    const t = tokens(selector);
    for (const [fg, bg] of TEXT) {
      const ratio = contrast(t[fg] as string, t[bg] as string);
      assert.ok(ratio >= 4.5, `${fg} on ${bg}: ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${name} theme: control edges and focus rings reach 3:1`, () => {
    const t = tokens(selector);
    for (const [fg, bg] of EDGES) {
      const ratio = contrast(t[fg] as string, t[bg] as string);
      assert.ok(ratio >= 3, `${fg} on ${bg}: ${ratio.toFixed(2)}:1`);
    }
  });
}

test("the light and dark sets define the same colour tokens", () => {
  const light = Object.keys(tokens(":root")).sort();
  const dark = Object.keys(tokens(".dark")).sort();
  assert.deepEqual(dark, light);
  assert.ok(light.length >= 18);
});
