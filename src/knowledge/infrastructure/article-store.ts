import type { ArticleRow, ArticleStore, RevisionRow } from "../application/ports.ts";
import type { Article, ArticleKind } from "../domain/article.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

type Row = { id: string; kind: string; slug: string; title: string; category: string; tags: string; body: string; status: string; decided_on: string | null; revision: number; updated_at: string };
type Revision = { revision: number; title: string; category: string; tags: string; body: string; saved_by_name: string | null; saved_at: string };

// Tags are kept as ",a,b," so one tag is found with a plain match on ",a,".
const packTags = (tags: readonly string[]) => (tags.length === 0 ? "," : `,${tags.join(",")},`);
const unpackTags = (text: string) => text.split(",").filter((tag) => tag.length > 0);
/** Makes typed text safe inside LIKE: its own % and _ are matched as written. */
const likeText = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function toArticle(row: Row): ArticleRow {
  return { id: row.id as Id, kind: row.kind as ArticleKind, slug: row.slug, title: row.title, category: row.category, tags: unpackTags(row.tags), body: row.body, status: row.status as Article["status"], decidedOn: row.decided_on, revision: row.revision, updatedAt: row.updated_at };
}
const toRevision = (row: Revision): RevisionRow => ({ revision: row.revision, title: row.title, category: row.category, tags: unpackTags(row.tags), body: row.body, savedByName: row.saved_by_name, savedAt: row.saved_at });

export function sqliteArticleStore(db: Database): ArticleStore {
  const columns = "id, kind, slug, title, category, tags, body, status, decided_on, revision, updated_at";
  const insert = db.prepare("insert into article (id, kind, slug, title, category, tags, body, status, decided_on, revision, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const update = db.prepare("update article set title = ?, category = ?, tags = ?, body = ?, revision = ?, updated_at = ? where id = ?");
  const addRevision = db.prepare("insert into article_revision (article_id, revision, title, category, tags, body, saved_by, saved_at) values (?, ?, ?, ?, ?, ?, ?, ?)");
  const setStatus = db.prepare("update article set status = ?, updated_at = ? where id = ?");
  const byId = db.prepare(`select ${columns} from article where id = ?`);
  const bySlug = db.prepare(`select ${columns} from article where slug = ?`);
  const count = db.prepare("select count(*) as n from article");
  const categories = db.prepare("select distinct category from article where status = 'current' order by category collate nocase");
  // Decisions by the day they were made, newest first. Then articles by title.
  const search = db.prepare(
    `select ${columns} from article
      where status = :status
        and (:kind = '' or kind = :kind)
        and (:category = '' or category = :category collate nocase)
        and (:tag = '' or tags like :tagLike escape '\\')
        and (:q = '' or title like :qLike escape '\\' or body like :qLike escape '\\' or category like :qLike escape '\\' or tags like :qLike escape '\\')
      order by kind desc, decided_on desc, title collate nocase, id`,
  );
  const revisionColumns = "r.revision, r.title, r.category, r.tags, r.body, u.name as saved_by_name, r.saved_at";
  const revisions = db.prepare(`select ${revisionColumns} from article_revision r left join user u on u.id = r.saved_by where r.article_id = ? order by r.revision`);
  const revision = db.prepare(`select ${revisionColumns} from article_revision r left join user u on u.id = r.saved_by where r.article_id = ? and r.revision = ?`);

  const writeRevision = (article: Article, savedBy: Id | null, at: string) => addRevision.run(article.id, article.revision, article.title, article.category, packTags(article.tags), article.body, savedBy, at);
  return {
    insert(article, savedBy, at) {
      insert.run(article.id, article.kind, article.slug, article.title, article.category, packTags(article.tags), article.body, article.status, article.decidedOn, article.revision, at, at);
      writeRevision(article, savedBy, at);
    },
    saveRevision(article, savedBy, at) {
      update.run(article.title, article.category, packTags(article.tags), article.body, article.revision, at, article.id);
      writeRevision(article, savedBy, at);
    },
    setStatus(id, status, at) {
      setStatus.run(status, at, id);
    },
    get(id) {
      const row = byId.get(id) as Row | undefined;
      return row ? toArticle(row) : null;
    },
    bySlug(slug) {
      const row = bySlug.get(slug) as Row | undefined;
      return row ? toArticle(row) : null;
    },
    slugTaken(slug) {
      return bySlug.get(slug) !== undefined;
    },
    search(wanted) {
      const rows = search.all({ ":status": wanted.archived ? "archived" : "current", ":kind": wanted.kind, ":category": wanted.category, ":tag": wanted.tag, ":tagLike": likeText(`,${wanted.tag},`), ":q": wanted.q, ":qLike": likeText(wanted.q) }) as Row[];
      return rows.map(toArticle);
    },
    categories() {
      return (categories.all() as { category: string }[]).map((row) => row.category);
    },
    revisions(id) {
      return (revisions.all(id) as Revision[]).map(toRevision);
    },
    revision(id, number) {
      const row = revision.get(id, number) as Revision | undefined;
      return row ? toRevision(row) : null;
    },
    count() {
      return count.get()?.["n"] as number;
    },
  };
}
