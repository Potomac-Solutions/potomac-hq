// Reads the documents HQ ships with (the docs/ folder) so they can be put
// into the knowledge base when HQ starts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SeedDocument } from "../application/knowledge.ts";

const TAGS: Readonly<Record<string, string>> = {
  workflow: "sales, delivery",
  "tool-boundaries": "tools, money",
  "data-model": "data, records",
  "authorization-matrix": "roles, permissions",
  conventions: "code, releases",
  "user-guide": "how to, start here",
  operations: "railway, backups, restore",
  "retention-policy": "data, privacy",
};

export function readDocuments(docsDir: string): SeedDocument[] {
  if (!existsSync(docsDir)) return [];
  const markdownIn = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".md")).sort() : []);
  const documents: SeedDocument[] = [];
  for (const name of markdownIn(docsDir)) {
    const slug = name.replace(/\.md$/, "");
    const scope = slug.startsWith("scope-");
    documents.push({ slug, markdown: readFileSync(join(docsDir, name), "utf8"), kind: "article", category: scope ? "Scope" : "How Potomac works", tags: TAGS[slug] ?? (scope ? "scope, roadmap" : "") });
  }
  for (const [folder, category, kind] of [["decisions", "Decisions", "decision"], ["reviews", "Reviews", "article"]] as const) {
    for (const name of markdownIn(join(docsDir, folder))) {
      const markdown = readFileSync(join(docsDir, folder, name), "utf8");
      const day = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(markdown)?.[1];
      documents.push({ slug: `${folder === "decisions" ? "decision" : "review"}-${name.replace(/\.md$/, "")}`, markdown, kind, category, tags: folder, ...(day ? { decidedOn: day } : {}) });
    }
  }
  return documents;
}
