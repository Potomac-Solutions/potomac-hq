import type { ApprovedBy, Network, PlanPage, PostKind, PostStatus, SocialPlan, SocialPost } from "../domain/social.ts";
import type { SocialStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const PLAN = "id, organization_id, pages, posts_per_month, blogs_per_month, about, paused";
const POST = "id, organization_id, kind, day, networks, title, words, link, picture, status, sent_at, approved_at, approved_by, approval_note, client_note, posted_at, posted_links, skip_reason";

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

function toPlan(row: Record<string, unknown>): SocialPlan {
  return {
    id: row["id"] as Id,
    organizationId: row["organization_id"] as Id,
    pages: JSON.parse(String(row["pages"])) as PlanPage[],
    postsPerMonth: Number(row["posts_per_month"]),
    blogsPerMonth: Number(row["blogs_per_month"]),
    about: String(row["about"]),
    paused: row["paused"] === 1,
  };
}

function toPost(row: Record<string, unknown>): SocialPost {
  return {
    id: row["id"] as Id,
    organizationId: row["organization_id"] as Id,
    kind: row["kind"] as PostKind,
    day: String(row["day"]),
    networks: JSON.parse(String(row["networks"])) as Network[],
    title: String(row["title"]),
    words: String(row["words"]),
    link: text(row["link"]),
    picture: String(row["picture"]),
    status: row["status"] as PostStatus,
    sentAt: text(row["sent_at"]),
    approvedAt: text(row["approved_at"]),
    approvedBy: text(row["approved_by"]) as ApprovedBy | null,
    approvalNote: String(row["approval_note"]),
    clientNote: String(row["client_note"]),
    postedAt: text(row["posted_at"]),
    postedLinks: JSON.parse(String(row["posted_links"])) as Record<string, string>,
    skipReason: String(row["skip_reason"]),
  };
}

const postValues = (p: SocialPost) => [p.kind, p.day, p.day.slice(0, 7), JSON.stringify(p.networks), p.title, p.words, p.link, p.picture, p.status, p.sentAt, p.approvedAt, p.approvedBy, p.approvalNote, p.clientNote, p.postedAt, JSON.stringify(p.postedLinks), p.skipReason];

export function sqliteSocialStore(db: Database): SocialStore {
  const insertPlan = db.prepare(`insert into social_plan (${PLAN}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const updatePlan = db.prepare("update social_plan set pages = ?, posts_per_month = ?, blogs_per_month = ?, about = ?, paused = ?, updated_at = ? where id = ?");
  const planFor = db.prepare(`select ${PLAN} from social_plan where organization_id = ?`);
  const plans = db.prepare(`select ${PLAN} from social_plan`);
  const insertPost = db.prepare(
    "insert into social_post (id, organization_id, kind, day, month, networks, title, words, link, picture, status, sent_at, approved_at, approved_by, approval_note, client_note, posted_at, posted_links, skip_reason, created_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const updatePost = db.prepare(
    "update social_post set kind = ?, day = ?, month = ?, networks = ?, title = ?, words = ?, link = ?, picture = ?, status = ?, sent_at = ?, approved_at = ?, approved_by = ?, approval_note = ?, client_note = ?, posted_at = ?, posted_links = ?, skip_reason = ?, updated_at = ? where id = ?",
  );
  const removePost = db.prepare("delete from social_post where id = ?");
  const getPost = db.prepare(`select ${POST} from social_post where id = ?`);
  const month = db.prepare(`select ${POST} from social_post where organization_id = ? and month = ? order by day, kind desc, created_at`);
  const inMonth = db.prepare(`select ${POST} from social_post where month = ? order by day, created_at`);
  const withStatus = db.prepare(`select ${POST} from social_post where status = ? order by day, created_at`);
  const forClientWithStatus = db.prepare(`select ${POST} from social_post where organization_id = ? and status = ? order by day, created_at`);
  return {
    insertPlan(plan, at) {
      insertPlan.run(plan.id, plan.organizationId, JSON.stringify(plan.pages), plan.postsPerMonth, plan.blogsPerMonth, plan.about, plan.paused ? 1 : 0, at, at);
    },
    updatePlan(plan, at) {
      updatePlan.run(JSON.stringify(plan.pages), plan.postsPerMonth, plan.blogsPerMonth, plan.about, plan.paused ? 1 : 0, at, plan.id);
    },
    planFor(organizationId) {
      const row = planFor.get(organizationId);
      return row ? toPlan(row) : null;
    },
    plans: () => plans.all().map(toPlan),
    insertPost(post, createdBy, at) {
      insertPost.run(post.id, post.organizationId, ...postValues(post), createdBy, at, at);
    },
    updatePost(post, at) {
      updatePost.run(...postValues(post), at, post.id);
    },
    removePost(id) {
      removePost.run(id);
    },
    post(id) {
      const row = getPost.get(id);
      return row ? toPost(row) : null;
    },
    month: (organizationId, which) => month.all(organizationId, which).map(toPost),
    everyonesMonth: (which) => inMonth.all(which).map(toPost),
    withStatus: (status) => withStatus.all(status).map(toPost),
    clientsWithStatus: (organizationId, status) => forClientWithStatus.all(organizationId, status).map(toPost),
  };
}
