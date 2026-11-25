// The static files the pages link to. A fixed list: nothing else under
// /assets is served, so a request can never name a path on disk.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "assets");

export type Asset = { readonly body: Uint8Array<ArrayBuffer>; readonly type: string };

const FILES: Readonly<Record<string, string>> = {
  "theme.css": "text/css; charset=utf-8",
  "potomac-mark.webp": "image/webp",
  "plex-sans.woff2": "font/woff2",
  "icon-192.png": "image/png",
  "icon-512.png": "image/png",
  "apple-touch-icon.png": "image/png",
  "sw.js": "text/javascript; charset=utf-8",
};

/** What a phone needs to install HQ to its home screen (quality of life, 2026-11-25). */
export const MANIFEST = JSON.stringify({
  name: "Potomac HQ",
  short_name: "HQ",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#0b5cad",
  icons: [
    { src: "/assets/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/assets/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
});

export function loadAssets(): ReadonlyMap<string, Asset> {
  const assets = new Map<string, Asset>();
  for (const [name, type] of Object.entries(FILES)) {
    assets.set(name, { body: new Uint8Array(readFileSync(join(dir, name))), type });
  }
  assets.set("theme-dark.css", { body: new TextEncoder().encode(darkTheme(readFileSync(join(dir, "theme.css"), "utf8"))), type: "text/css; charset=utf-8" });
  return assets;
}

/**
 * The theme's dark colours as their own stylesheet: the `.dark` block of
 * theme.css with its selector rewritten to `:root`. Linking it switches the
 * whole page to dark with no script and no class on <html>.
 */
export function darkTheme(css: string): string {
  const start = css.indexOf("\n.dark {");
  const end = css.indexOf("\n}", start);
  if (start === -1 || end === -1) throw new Error("theme.css has no .dark block");
  return `:root {${css.slice(start + "\n.dark {".length, end)}\n}\n`;
}

/** The stylesheet links for a theme choice. "system" follows the device. */
export function themeLinks(theme: "system" | "light" | "dark"): string {
  const base = '<link rel="stylesheet" href="/assets/theme.css">';
  if (theme === "light") return base;
  return `${base}<link rel="stylesheet" href="/assets/theme-dark.css"${theme === "system" ? ' media="(prefers-color-scheme: dark)"' : ""}>`;
}
