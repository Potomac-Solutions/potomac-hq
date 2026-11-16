// The knowledge base (docs/data-model.md, "v1.0"). An article is how
// something is done here. A decision is an article with the day it was made.
// Every save is kept as a revision.
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const ARTICLE_KINDS = ["article", "decision"] as const;
export type ArticleKind = (typeof ARTICLE_KINDS)[number];
export const KIND_LABELS: Readonly<Record<ArticleKind, string>> = { article: "Article", decision: "Decision" };

export type Article = {
  readonly id: Id;
  readonly kind: ArticleKind;
  /** The article's address: /knowledge/<slug>. Never changes. */
  readonly slug: string;
  readonly title: string;
  readonly category: string;
  /** Lower case, sorted, each once. */
  readonly tags: readonly string[];
  readonly body: string;
  readonly status: "current" | "archived";
  /** The day a decision was made, YYYY-MM-DD. Null for an article. */
  readonly decidedOn: string | null;
  readonly revision: number;
};

export type ArticleError = "title-missing" | "title-too-long" | "category-missing" | "category-too-long" | "body-missing" | "body-too-long" | "too-many-tags" | "invalid-kind" | "invalid-day";

export const MAX_BODY = 40_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isArticleKind(kind: string): kind is ArticleKind {
  return (ARTICLE_KINDS as readonly string[]).includes(kind);
}

/** "Backups, Railway; restore drill" becomes ["backups", "railway", "restore drill"]. */
export function cleanTags(text: string): string[] {
  const tags = text
    .split(/[,;\n]/)
    .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, " "))
    .filter((tag) => tag.length > 0 && tag.length <= 40);
  return [...new Set(tags)].sort();
}

/** An address made from a title: "Restore drill, step by step" becomes "restore-drill-step-by-step". */
export function slugFor(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return slug || "article";
}

type Fields = { readonly title: string; readonly category: string; readonly tags: string; readonly body: string; readonly kind?: string; readonly decidedOn?: string };

function checked(fields: Fields): Result<{ title: string; category: string; tags: string[]; body: string }, ArticleError> {
  const title = fields.title.trim().replace(/\s+/g, " ");
  const category = fields.category.trim().replace(/\s+/g, " ");
  const body = fields.body.replace(/\r\n?/g, "\n").trim();
  if (title.length === 0) return err("title-missing");
  if (title.length > 200) return err("title-too-long");
  if (category.length === 0) return err("category-missing");
  if (category.length > 60) return err("category-too-long");
  if (body.length === 0) return err("body-missing");
  if (body.length > MAX_BODY) return err("body-too-long");
  const tags = cleanTags(fields.tags);
  if (tags.length > 12) return err("too-many-tags");
  return ok({ title, category, tags, body });
}

function isDay(text: string): boolean {
  if (!DAY.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

export function newArticle(id: Id, slug: string, fields: Fields, today: string): Result<Article, ArticleError> {
  const kind = fields.kind ?? "article";
  if (!isArticleKind(kind)) return err("invalid-kind");
  const content = checked(fields);
  if (!content.ok) return content;
  let decidedOn: string | null = null;
  if (kind === "decision") {
    decidedOn = (fields.decidedOn ?? "").trim() || today;
    if (!isDay(decidedOn) || decidedOn > today) return err("invalid-day");
  }
  return ok({ id, kind, slug, ...content.value, status: "current", decidedOn, revision: 1 });
}

/** A new revision of an article. "unchanged" when nothing differs. Its kind, slug and day stay. */
export function editArticle(article: Article, fields: Fields): Result<Article, ArticleError | "unchanged" | "archived"> {
  if (article.status === "archived") return err("archived");
  const content = checked(fields);
  if (!content.ok) return content;
  const next = content.value;
  if (next.title === article.title && next.category === article.category && next.body === article.body && next.tags.join() === article.tags.join()) return err("unchanged");
  return ok({ ...article, ...next, revision: article.revision + 1 });
}

export function setArchived(article: Article, archived: boolean): Result<Article, "unchanged"> {
  const status = archived ? "archived" : "current";
  return article.status === status ? err("unchanged") : ok({ ...article, status });
}
