// Public entry for the knowledge base: how things are done at Potomac, and
// the decisions that were made, with every revision kept.
export { ARTICLE_KINDS, KIND_LABELS, type Article, type ArticleError, type ArticleKind } from "./domain/article.ts";
export type { Block } from "./domain/blocks.ts";
export type { ArticleRow, ArticleSearch, ArticleStore, RevisionRow } from "./application/ports.ts";
export { articleDetail, articleRevision, createArticle, listArticles, saveArticle, seedKnowledge, setArticleArchived, type ArticleSummary, type BlockView, type ArticleView, type KnowledgeDeps, type KnowledgeView, type RevisionView, type SeedDocument } from "./application/knowledge.ts";
