// The knowledge base: read, search, write, edit and archive articles and
// decisions. Each change checks its permission first and writes an activity
// event. Reading changes nothing and writes none.
import { editArticle, isArticleKind, KIND_LABELS, newArticle, setArchived, slugFor, type Article, type ArticleError } from "../domain/article.ts";
import { splitTitle, toBlocks, type Block } from "../domain/blocks.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { ArticleRow, ArticleStore } from "./ports.ts";

export type KnowledgeDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly articles: ArticleStore;
  readonly today: () => string;
  readonly formatWhen: (instant: string) => string;
};

/** A body's blocks as a page shows them: flat, with a key on everything that repeats. */
export type BlockView = {
  readonly key: number;
  readonly type: Block["type"];
  readonly level: number;
  readonly ordered: boolean;
  readonly text: string;
  readonly items: readonly { readonly key: number; readonly text: string }[];
  readonly header: readonly { readonly key: number; readonly text: string }[];
  readonly rows: readonly { readonly key: number; readonly cells: readonly { readonly key: number; readonly text: string }[] }[];
};

const keyed = (texts: readonly string[]) => texts.map((text, key) => ({ key, text }));

export function viewBlocks(body: string): BlockView[] {
  return toBlocks(body).map((block, key) => ({
    key,
    type: block.type,
    level: block.type === "heading" ? block.level : 0,
    ordered: block.type === "list" && block.ordered,
    text: block.type === "heading" || block.type === "paragraph" || block.type === "code" ? block.text : "",
    items: block.type === "list" ? keyed(block.items) : [],
    header: block.type === "table" ? keyed(block.header) : [],
    rows: block.type === "table" ? block.rows.map((row, n) => ({ key: n, cells: keyed(row) })) : [],
  }));
}

const may = (deps: KnowledgeDeps, actorId: Id | null, action: string): boolean => actorId !== null && authorize(deps, actorId, action).ok;

export type ArticleSummary = { readonly slug: string; readonly title: string; readonly kindLabel: string; readonly isDecision: boolean; readonly category: string; readonly tags: readonly string[]; readonly decidedOn: string; readonly updated: string; readonly archived: boolean; readonly excerpt: string };

export type KnowledgeView = {
  readonly items: readonly ArticleSummary[];
  readonly categories: readonly string[];
  readonly filter: { readonly q: string; readonly category: string; readonly tag: string; readonly kind: string; readonly archived: boolean };
  readonly filtered: boolean;
  readonly canEdit: boolean;
  readonly today: string;
};

function excerpt(body: string): string {
  const first = toBlocks(body).find((block) => block.type === "paragraph");
  const text = first && first.type === "paragraph" ? first.text : "";
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function summary(deps: KnowledgeDeps, article: ArticleRow): ArticleSummary {
  return { slug: article.slug, title: article.title, kindLabel: KIND_LABELS[article.kind], isDecision: article.kind === "decision", category: article.category, tags: article.tags, decidedOn: article.decidedOn ?? "", updated: deps.formatWhen(article.updatedAt), archived: article.status === "archived", excerpt: excerpt(article.body) };
}

export function listArticles(deps: KnowledgeDeps, actorId: Id | null, raw: { readonly q?: string; readonly category?: string; readonly tag?: string; readonly kind?: string; readonly archived?: string }): Result<KnowledgeView, "forbidden"> {
  if (!may(deps, actorId, "knowledge.view")) return err("forbidden");
  const q = (raw.q ?? "").trim().slice(0, 100);
  const category = (raw.category ?? "").trim().slice(0, 60);
  const tag = (raw.tag ?? "").trim().toLowerCase().slice(0, 40);
  const kind = isArticleKind(raw.kind ?? "") ? (raw.kind as "article" | "decision") : "";
  const archived = raw.archived === "1";
  return ok({
    items: deps.articles.search({ q, category, tag, kind, archived }).map((article) => summary(deps, article)),
    categories: deps.articles.categories(),
    filter: { q, category, tag, kind, archived },
    filtered: Boolean(q || category || tag || kind || archived),
    canEdit: may(deps, actorId, "knowledge.edit"),
    today: deps.today(),
  });
}

export type ArticleView = {
  readonly article: { readonly id: string; readonly slug: string; readonly title: string; readonly kindLabel: string; readonly isDecision: boolean; readonly category: string; readonly tags: readonly string[]; readonly tagsText: string; readonly body: string; readonly decidedOn: string; readonly archived: boolean; readonly revision: number };
  readonly blocks: readonly BlockView[];
  readonly revisions: readonly { readonly revision: number; readonly who: string; readonly when: string; readonly whenIso: string; readonly current: boolean }[];
  readonly canEdit: boolean;
};

export function articleDetail(deps: KnowledgeDeps, actorId: Id | null, slug: string): Result<ArticleView, "forbidden" | "not-found"> {
  if (!may(deps, actorId, "knowledge.view")) return err("forbidden");
  const article = deps.articles.bySlug(slug);
  if (!article) return err("not-found");
  return ok({
    article: { id: article.id, slug: article.slug, title: article.title, kindLabel: KIND_LABELS[article.kind], isDecision: article.kind === "decision", category: article.category, tags: article.tags, tagsText: article.tags.join(", "), body: article.body, decidedOn: article.decidedOn ?? "", archived: article.status === "archived", revision: article.revision },
    blocks: viewBlocks(article.body),
    revisions: deps.articles
      .revisions(article.id)
      .reverse()
      .map((one) => ({ revision: one.revision, who: one.savedByName ?? "Potomac HQ", when: deps.formatWhen(one.savedAt), whenIso: one.savedAt, current: one.revision === article.revision })),
    canEdit: may(deps, actorId, "knowledge.edit"),
  });
}

export type RevisionView = { readonly slug: string; readonly currentTitle: string; readonly revision: number; readonly title: string; readonly category: string; readonly tags: readonly string[]; readonly who: string; readonly when: string; readonly blocks: readonly BlockView[]; readonly current: boolean };

export function articleRevision(deps: KnowledgeDeps, actorId: Id | null, slug: string, revision: number): Result<RevisionView, "forbidden" | "not-found"> {
  if (!may(deps, actorId, "knowledge.view")) return err("forbidden");
  const article = deps.articles.bySlug(slug);
  const found = article && Number.isInteger(revision) ? deps.articles.revision(article.id, revision) : null;
  if (!article || !found) return err("not-found");
  return ok({ slug: article.slug, currentTitle: article.title, revision: found.revision, title: found.title, category: found.category, tags: found.tags, who: found.savedByName ?? "Potomac HQ", when: deps.formatWhen(found.savedAt), blocks: viewBlocks(found.body), current: found.revision === article.revision });
}

type Input = { readonly title: string; readonly category: string; readonly tags: string; readonly body: string; readonly kind?: string; readonly decidedOn?: string };

/** A slug nobody has yet: the title's, then with -2, -3 and so on. Call inside a transaction. */
function freeSlug(deps: KnowledgeDeps, title: string): string {
  const base = slugFor(title);
  if (!deps.articles.slugTaken(base)) return base;
  for (let n = 2; ; n++) if (!deps.articles.slugTaken(`${base}-${n}`)) return `${base}-${n}`;
}

export function createArticle(deps: KnowledgeDeps, actorId: Id | null, input: Input): Result<Article, "forbidden" | ArticleError> {
  if (!may(deps, actorId, "knowledge.edit")) return err("forbidden");
  return deps.transact(() => {
    const article = newArticle(deps.newId(), freeSlug(deps, input.title), input, deps.today());
    if (!article.ok) return article;
    deps.articles.insert(article.value, actorId, deps.clock());
    recordActivity(deps, { actorId, action: article.value.kind === "decision" ? "decision.recorded" : "article.created", recordType: "article", recordId: article.value.id, context: { slug: article.value.slug } });
    return article;
  });
}

export function saveArticle(deps: KnowledgeDeps, actorId: Id | null, articleId: Id, input: Input): Result<Article, "forbidden" | "not-found" | ArticleError | "unchanged" | "archived"> {
  if (!may(deps, actorId, "knowledge.edit")) return err("forbidden");
  return deps.transact(() => {
    const current = deps.articles.get(articleId);
    if (!current) return err("not-found");
    const edited = editArticle(current, input);
    if (!edited.ok) return edited;
    deps.articles.saveRevision(edited.value, actorId, deps.clock());
    recordActivity(deps, { actorId, action: "article.edited", recordType: "article", recordId: current.id, context: { slug: current.slug, revision: edited.value.revision } });
    return edited;
  });
}

export function setArticleArchived(deps: KnowledgeDeps, actorId: Id | null, articleId: Id, archived: boolean): Result<Article, "forbidden" | "not-found" | "unchanged"> {
  if (!may(deps, actorId, "knowledge.edit")) return err("forbidden");
  return deps.transact(() => {
    const current = deps.articles.get(articleId);
    if (!current) return err("not-found");
    const changed = setArchived(current, archived);
    if (!changed.ok) return changed;
    deps.articles.setStatus(current.id, changed.value.status, deps.clock());
    recordActivity(deps, { actorId, action: archived ? "article.archived" : "article.restored", recordType: "article", recordId: current.id, context: { slug: current.slug } });
    return changed;
  });
}

/** One of the documents HQ ships with. */
export type SeedDocument = { readonly slug: string; readonly markdown: string; readonly kind: "article" | "decision"; readonly category: string; readonly tags: string; readonly decidedOn?: string };

/**
 * Puts HQ's own documents into the knowledge base, once each. A document
 * whose slug is already there is left alone, so an article someone edited
 * is never overwritten. Run when HQ starts: there is no signed-in person,
 * and nothing is granted that anyone could ask for.
 */
export function seedKnowledge(deps: KnowledgeDeps, documents: readonly SeedDocument[]): { added: string[]; skipped: { slug: string; error: string }[] } {
  return deps.transact(() => {
    const added: string[] = [];
    let firstId: Id | null = null;
    const skipped: { slug: string; error: string }[] = [];
    for (const document of documents) {
      if (deps.articles.slugTaken(document.slug)) continue;
      const { title, body } = splitTitle(document.markdown);
      const today = deps.today();
      const decidedOn = document.decidedOn && document.decidedOn <= today ? document.decidedOn : today;
      const article = newArticle(deps.newId(), document.slug, { title: title || document.slug, category: document.category, tags: document.tags, body, kind: document.kind, decidedOn }, today);
      if (!article.ok) {
        skipped.push({ slug: document.slug, error: article.error });
        continue;
      }
      deps.articles.insert(article.value, null, deps.clock());
      firstId ??= article.value.id;
      added.push(document.slug);
    }
    if (firstId !== null) recordActivity(deps, { actorId: null, action: "knowledge.seeded", recordType: "article", recordId: firstId, context: { added } });
    return { added, skipped };
  });
}
