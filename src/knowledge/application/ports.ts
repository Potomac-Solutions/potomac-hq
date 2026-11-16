import type { Article, ArticleKind } from "../domain/article.ts";
import type { Id } from "../../shared/index.ts";

export type ArticleSearch = {
  /** Words to find in the title, body, category or tags. Empty for all. */
  readonly q: string;
  readonly category: string;
  readonly tag: string;
  /** Empty for both kinds. */
  readonly kind: ArticleKind | "";
  readonly archived: boolean;
};

export type ArticleRow = Article & { readonly updatedAt: string };
export type RevisionRow = { readonly revision: number; readonly title: string; readonly category: string; readonly tags: readonly string[]; readonly body: string; readonly savedByName: string | null; readonly savedAt: string };

export type ArticleStore = {
  /** Saves a new article and its first revision. */
  insert(article: Article, savedBy: Id | null, at: string): void;
  /** Saves an edited article and its new revision. */
  saveRevision(article: Article, savedBy: Id | null, at: string): void;
  setStatus(id: Id, status: Article["status"], at: string): void;
  get(id: Id): ArticleRow | null;
  bySlug(slug: string): ArticleRow | null;
  slugTaken(slug: string): boolean;
  search(search: ArticleSearch): ArticleRow[];
  categories(): string[];
  revisions(id: Id): RevisionRow[];
  revision(id: Id, revision: number): RevisionRow | null;
  count(): number;
};
