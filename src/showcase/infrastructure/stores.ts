import type { CaseStudy, Review, ReviewSource } from "../domain/showcase.ts";
import type { CaseStudyStore, RequestStore, ReviewStore, Shot } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const REVIEW = "id, organization_id, rating, text, display_name, town, may_publish, source, status, created_at";

function toReview(row: Record<string, unknown>): Review {
  return { id: row["id"] as Id, organizationId: row["organization_id"] as Id, rating: Number(row["rating"]), text: String(row["text"]), displayName: String(row["display_name"]), town: String(row["town"]), mayPublish: Number(row["may_publish"]) === 1, source: row["source"] as ReviewSource, status: row["status"] as Review["status"], createdAt: String(row["created_at"]) };
}

export function sqliteReviewStore(db: Database): ReviewStore {
  const get = db.prepare(`select ${REVIEW} from review where id = ?`);
  const list = db.prepare(`select ${REVIEW} from review order by created_at desc`);
  const published = db.prepare(`select ${REVIEW} from review where status = 'published' order by created_at desc`);
  const insert = db.prepare(`insert into review (${REVIEW}, request_id, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const setStatus = db.prepare("update review set status = ?, published_at = case when ? = 'published' then ? else published_at end, updated_at = ? where id = ?");
  const hasClient = db.prepare("select 1 as one from review where organization_id = ? and source = 'client' limit 1");
  return {
    get(id) {
      const row = get.get(id);
      return row ? toReview(row) : null;
    },
    list: () => list.all().map(toReview),
    published: () => published.all().map(toReview),
    insert(r, requestId, at) {
      insert.run(r.id, r.organizationId, r.rating, r.text, r.displayName, r.town, r.mayPublish ? 1 : 0, r.source, r.status, r.createdAt, requestId, at);
    },
    setStatus(id, status, at) {
      setStatus.run(status, status, at, at, id);
    },
    hasClientReview: (organizationId) => hasClient.get(organizationId) !== undefined,
  };
}

export function sqliteRequestStore(db: Database): RequestStore {
  const insert = db.prepare("insert into review_request (id, organization_id, email, token_hash, expires_at, created_by, created_at) values (?, ?, ?, ?, ?, ?, ?)");
  const byHash = db.prepare("select id, organization_id, expires_at, used_at from review_request where token_hash = ?");
  const used = db.prepare("update review_request set used_at = ? where id = ? and used_at is null");
  const open = db.prepare("select count(*) as n from review_request where organization_id = ? and used_at is null and expires_at > ?");
  return {
    insert(r, at) {
      insert.run(r.id, r.organizationId, r.email, r.tokenHash, r.expiresAt, r.createdBy, at);
    },
    byTokenHash(hash) {
      const row = byHash.get(hash);
      return row ? { id: row["id"] as Id, organizationId: row["organization_id"] as Id, expiresAt: String(row["expires_at"]), usedAt: row["used_at"] === null ? null : String(row["used_at"]) } : null;
    },
    markUsed(id, at) {
      used.run(at, id);
    },
    openFor: (organizationId, now) => Number(open.get(organizationId, now)?.["n"] ?? 0),
  };
}

const STUDY = "id, organization_id, headline, problem, built, result, live_url, position, published";

function toStudy(row: Record<string, unknown>): CaseStudy {
  return { id: row["id"] as Id, organizationId: row["organization_id"] as Id, headline: String(row["headline"]), problem: String(row["problem"]), built: String(row["built"]), result: String(row["result"]), liveUrl: String(row["live_url"]), position: Number(row["position"]), published: Number(row["published"]) === 1 };
}

const toShot = (row: Record<string, unknown>): Shot => ({ id: row["id"] as Id, caseStudyId: row["case_study_id"] as Id, contentType: String(row["content_type"]), alt: String(row["alt"]), position: Number(row["position"]) });

export function sqliteCaseStudyStore(db: Database): CaseStudyStore {
  const get = db.prepare(`select ${STUDY} from case_study where id = ?`);
  const byOrg = db.prepare(`select ${STUDY} from case_study where organization_id = ?`);
  const list = db.prepare(`select ${STUDY} from case_study order by position, headline`);
  const insert = db.prepare(`insert into case_study (${STUDY}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const save = db.prepare("update case_study set headline = ?, problem = ?, built = ?, result = ?, live_url = ?, position = ?, published = ?, updated_at = ? where id = ?");
  const shots = db.prepare("select id, case_study_id, content_type, alt, position from case_study_shot where case_study_id = ? order by position");
  const shot = db.prepare("select id, case_study_id, content_type, alt, position, bytes from case_study_shot where id = ?");
  const addShot = db.prepare("insert into case_study_shot (id, case_study_id, content_type, bytes, alt, position, created_at) values (?, ?, ?, ?, ?, ?, ?)");
  const removeShot = db.prepare("delete from case_study_shot where id = ?");
  const one = (row: Record<string, unknown> | undefined) => (row ? toStudy(row) : null);
  return {
    get: (id) => one(get.get(id)),
    forOrganization: (organizationId) => one(byOrg.get(organizationId)),
    list: () => list.all().map(toStudy),
    insert(s, at) {
      insert.run(s.id, s.organizationId, s.headline, s.problem, s.built, s.result, s.liveUrl, s.position, s.published ? 1 : 0, at, at);
    },
    save(s, at) {
      save.run(s.headline, s.problem, s.built, s.result, s.liveUrl, s.position, s.published ? 1 : 0, at, s.id);
    },
    shots: (caseStudyId) => shots.all(caseStudyId).map(toShot),
    shot(id) {
      const row = shot.get(id);
      return row ? { ...toShot(row), bytes: new Uint8Array(row["bytes"] as Uint8Array) } : null;
    },
    addShot(s, bytes, at) {
      addShot.run(s.id, s.caseStudyId, s.contentType, bytes, s.alt, s.position, at);
    },
    removeShot(id) {
      removeShot.run(id);
    },
  };
}
