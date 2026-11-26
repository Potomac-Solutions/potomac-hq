// Every staff page is somewhere a person can find it (decision 0015).
import assert from "node:assert/strict";
import { test } from "node:test";
import { PLACES } from "../../src/dashboard/domain/places.ts";

// A page no one can find is a feature lost: every staff page with a fixed
// address is in PLACES, so the sidebar, search and the assistant know it.
test("every staff page with a fixed address is a place", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = join(import.meta.dirname, "..", "..", "src");
  const routes: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith(".zb")) {
        const route = /'use route ([^']+)'/.exec(readFileSync(join(dir, entry.name), "utf8"))?.[1];
        if (route && !route.includes(":")) routes.push(route);
      }
    }
  };
  walk(root);
  // Not staff pages: the client portal, the public site's forms, and signing in.
  const outside = /^\/(portal|book|contact|review|river|forgot-password)(\/|$)/;
  // Search is the header's box and the phone's tab, on every page already.
  const known = new Set([...PLACES.map((place) => place.href), "/search"]);
  assert.deepEqual(routes.filter((route) => !outside.test(route) && !known.has(route)).sort(), []);
});
