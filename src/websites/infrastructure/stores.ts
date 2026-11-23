import type { SiteContent } from "../domain/content.ts";
import type { LaunchMode } from "../domain/launch.ts";
import type { ContentSite, DraftState } from "../domain/site.ts";
import type { ContentSiteStore, PhotoStore, StoredPhoto } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const COLUMNS = "id, organization_id, name, repo_owner, repo_name, branch, content_path, photo_dir, published, published_at, published_commit, draft, draft_state, submitted_at, submitted_by, note, site_url, launch_mode, opens_at, launch_message, preview_key";
const maybe = (value: unknown) => (value === null || value === undefined ? null : String(value));

function toSite(row: Record<string, unknown>): ContentSite {
  return {
    id: row["id"] as Id,
    organizationId: row["organization_id"] as Id,
    name: String(row["name"]),
    repo: { owner: String(row["repo_owner"]), name: String(row["repo_name"]), branch: String(row["branch"]) },
    contentPath: String(row["content_path"]),
    photoDir: String(row["photo_dir"]),
    published: JSON.parse(String(row["published"])) as SiteContent,
    publishedAt: maybe(row["published_at"]),
    publishedCommit: maybe(row["published_commit"]),
    draft: row["draft"] === null ? null : (JSON.parse(String(row["draft"])) as SiteContent),
    draftState: row["draft_state"] as DraftState,
    submittedAt: maybe(row["submitted_at"]),
    submittedBy: maybe(row["submitted_by"]),
    note: String(row["note"]),
    siteUrl: String(row["site_url"]),
    launch: { mode: row["launch_mode"] as LaunchMode, opensAt: maybe(row["opens_at"]), message: String(row["launch_message"]) },
    previewKey: maybe(row["preview_key"]),
  };
}

export function sqliteContentSiteStore(db: Database): ContentSiteStore {
  const insert = db.prepare(`insert into content_site (${COLUMNS}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const save = db.prepare("update content_site set name = ?, repo_owner = ?, repo_name = ?, branch = ?, content_path = ?, photo_dir = ?, published = ?, published_at = ?, published_commit = ?, draft = ?, draft_state = ?, submitted_at = ?, submitted_by = ?, note = ?, site_url = ?, launch_mode = ?, opens_at = ?, launch_message = ?, preview_key = ?, updated_at = ? where id = ?");
  const get = db.prepare(`select ${COLUMNS} from content_site where id = ?`);
  const forClient = db.prepare(`select ${COLUMNS} from content_site where organization_id = ?`);
  const list = db.prepare(`select ${COLUMNS} from content_site order by case draft_state when 'submitted' then 0 when 'editing' then 1 else 2 end, name`);
  const fields = (s: ContentSite) => [s.name, s.repo.owner, s.repo.name, s.repo.branch, s.contentPath, s.photoDir, JSON.stringify(s.published), s.publishedAt, s.publishedCommit, s.draft ? JSON.stringify(s.draft) : null, s.draftState, s.submittedAt, s.submittedBy, s.note, s.siteUrl, s.launch.mode, s.launch.opensAt, s.launch.message, s.previewKey] as const;
  return {
    insert(site, at) {
      insert.run(site.id, site.organizationId, ...fields(site), at, at);
    },
    save(site, at) {
      save.run(...fields(site), at, site.id);
    },
    get(id) {
      const row = get.get(id);
      return row ? toSite(row) : null;
    },
    forOrganization(organizationId) {
      const row = forClient.get(organizationId);
      return row ? toSite(row) : null;
    },
    list: () => list.all().map(toSite),
  };
}

const toPhoto = (row: Record<string, unknown>): StoredPhoto => ({ id: row["id"] as Id, siteId: row["site_id"] as Id, path: String(row["path"]), contentType: String(row["content_type"]), inRepo: row["in_repo"] === 1 });

export function sqlitePhotoStore(db: Database): PhotoStore {
  const put = db.prepare("insert into content_photo (id, site_id, path, content_type, in_repo, body, created_at) values (?, ?, ?, ?, ?, ?, ?)");
  const get = db.prepare("select id, site_id, path, content_type, in_repo from content_photo where id = ?");
  const body = db.prepare("select body from content_photo where id = ?");
  const listFor = db.prepare("select id, site_id, path, content_type, in_repo from content_photo where site_id = ? order by created_at, id");
  const mark = db.prepare("update content_photo set in_repo = 1 where id = ?");
  const remove = db.prepare("delete from content_photo where id = ?");
  const removeAll = db.prepare("delete from content_photo where site_id = ?");
  return {
    put(photo, bytes, at) {
      put.run(photo.id, photo.siteId, photo.path, photo.contentType, photo.inRepo ? 1 : 0, bytes, at);
    },
    get(id) {
      const row = get.get(id);
      return row ? toPhoto(row) : null;
    },
    body(id) {
      const found = body.get(id)?.["body"];
      return found instanceof Uint8Array ? new Uint8Array(found) : null;
    },
    listFor: (siteId) => listFor.all(siteId).map(toPhoto),
    markInRepo(id) {
      mark.run(id);
    },
    remove(id) {
      remove.run(id);
    },
    removeAllFor(siteId) {
      removeAll.run(siteId);
    },
  };
}
