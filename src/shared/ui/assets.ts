// The static files the pages link to. A fixed list: nothing else under
// /assets is served, so a request can never name a path on disk.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "assets");

export type Asset = { readonly body: Uint8Array<ArrayBuffer>; readonly type: string };

const FILES: Readonly<Record<string, string>> = {
  "theme.css": "text/css; charset=utf-8",
  "potomac-mark.webp": "image/webp",
};

export function loadAssets(): ReadonlyMap<string, Asset> {
  const assets = new Map<string, Asset>();
  for (const [name, type] of Object.entries(FILES)) {
    assets.set(name, { body: new Uint8Array(readFileSync(join(dir, name))), type });
  }
  return assets;
}
