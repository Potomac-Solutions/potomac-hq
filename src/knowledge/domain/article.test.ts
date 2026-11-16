import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { cleanTags, editArticle, newArticle, setArchived, slugFor } from "./article.ts";
import { plain, splitTitle, toBlocks } from "./blocks.ts";

const id = "11111111-1111-4111-8111-111111111111" as Id;
const fields = { title: " Restore  drill ", category: "Operations", tags: "Backups, railway; backups", body: "Run it.\r\nThen check." };

test("a new article is cleaned up and starts at revision 1", () => {
  const made = newArticle(id, "restore-drill", fields, "2026-11-16");
  assert.deepEqual(made, { ok: true, value: { id, kind: "article", slug: "restore-drill", title: "Restore drill", category: "Operations", tags: ["backups", "railway"], body: "Run it.\nThen check.", status: "current", decidedOn: null, revision: 1 } });
  for (const [change, error] of [[{ title: " " }, "title-missing"], [{ category: "" }, "category-missing"], [{ body: "\n" }, "body-missing"], [{ body: "x".repeat(60_001) }, "body-too-long"], [{ kind: "memo" }, "invalid-kind"], [{ tags: Array.from({ length: 13 }, (_v, n) => `t${n}`).join(",") }, "too-many-tags"]] as const) {
    assert.deepEqual(newArticle(id, "s", { ...fields, ...change }, "2026-11-16"), { ok: false, error }, error);
  }
});

test("a decision has the day it was made, today unless said, never in the future", () => {
  const decided = (decidedOn?: string) => newArticle(id, "s", { ...fields, kind: "decision", ...(decidedOn === undefined ? {} : { decidedOn }) }, "2026-11-16");
  assert.equal(decided().ok && decided().ok ? (decided() as { value: { decidedOn: string } }).value.decidedOn : "", "2026-11-16");
  assert.equal((decided("2026-11-01") as { value: { decidedOn: string } }).value.decidedOn, "2026-11-01");
  assert.deepEqual(decided("2026-11-17"), { ok: false, error: "invalid-day" });
  assert.deepEqual(decided("2026-02-30"), { ok: false, error: "invalid-day" });
});

test("an edit makes the next revision, and only when something changed", () => {
  const article = (newArticle(id, "restore-drill", fields, "2026-11-16") as { value: Parameters<typeof editArticle>[0] }).value;
  assert.deepEqual(editArticle(article, fields), { ok: false, error: "unchanged" });
  const edited = editArticle(article, { ...fields, body: "Run it twice." });
  assert.ok(edited.ok);
  assert.deepEqual([edited.value.revision, edited.value.body, edited.value.slug], [2, "Run it twice.", "restore-drill"]);
  const archived = setArchived(article, true);
  assert.ok(archived.ok);
  assert.deepEqual(editArticle(archived.value, { ...fields, body: "x" }), { ok: false, error: "archived" });
  assert.deepEqual(setArchived(article, false), { ok: false, error: "unchanged" });
});

test("slugs and tags", () => {
  assert.equal(slugFor("Restore drill, step by step!"), "restore-drill-step-by-step");
  assert.equal(slugFor("  ¿Qué?  "), "que");
  assert.equal(slugFor("!!!"), "article");
  assert.ok(slugFor("x".repeat(300)).length <= 80);
  assert.deepEqual(cleanTags(" Railway ,backups;\nRestore  Drill,, railway"), ["backups", "railway", "restore drill"]);
});

test("a body becomes blocks, and nothing in it is treated as HTML", () => {
  const blocks = toBlocks(["# Title", "", "First **bold** line", "runs on.", "", "## Steps", "1. One", "2. Two", "   more of two", "", "- a `code` item", "- [docs](https://example.com)", "", "| Key | Value |", "| --- | --- |", "| `a` | 1 |", "| b |", "", "```", "npm run backup", "<script>", "```", "", "<b>not html</b>"].join("\n"));
  assert.deepEqual(blocks, [
    { type: "heading", level: 2, text: "Title" },
    { type: "paragraph", text: "First bold line runs on." },
    { type: "heading", level: 2, text: "Steps" },
    { type: "list", ordered: true, items: ["One", "Two more of two"] },
    { type: "list", ordered: false, items: ["a code item", "docs (https://example.com)"] },
    { type: "table", header: ["Key", "Value"], rows: [["a", "1"], ["b", ""]] },
    { type: "code", text: "npm run backup\n<script>" },
    { type: "paragraph", text: "<b>not html</b>" },
  ]);
  assert.deepEqual(toBlocks(""), []);
  assert.equal(plain("a * b * c and 2*3"), "a * b * c and 2*3");
});

test("a document's first heading is its title", () => {
  assert.deepEqual(splitTitle("# Workflow\n\nStatus: approved.\n\n## One\n"), { title: "Workflow", body: "Status: approved.\n\n## One" });
  assert.deepEqual(splitTitle("No heading here."), { title: "", body: "No heading here." });
});
