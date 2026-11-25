import type { BuilderSettingsStore, BuildStore, ImageStore, Publish, PublishStore, VersionLine } from "../application/ports.ts";
import type { BuildImage, ImageKind } from "../domain/image.ts";
import type { Build, BuildRequest, BuildVersion, RequestState } from "../domain/build.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

type Row = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const int = (value: unknown): number => (typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : 0);

const toBuild = (row: Row): Build => ({ id: text(row["id"]) as Id, organizationId: text(row["organization_id"]) as Id, name: text(row["name"]), brief: text(row["brief"]), createdBy: text(row["created_by"]) as Id, createdAt: text(row["created_at"]), referenceFrom: text(row["reference_from"]) });

const toRequest = (row: Row): BuildRequest => ({
  id: text(row["id"]) as Id,
  buildId: text(row["build_id"]) as Id,
  askedBy: text(row["asked_by"]) as Id,
  ask: text(row["ask"]),
  model: text(row["model"]),
  state: text(row["state"]) as RequestState,
  reservedMicros: int(row["reserved_micros"]),
  costMicros: int(row["cost_micros"]),
  inputTokens: int(row["input_tokens"]),
  outputTokens: int(row["output_tokens"]),
  error: typeof row["error"] === "string" ? row["error"] : null,
  createdAt: text(row["created_at"]),
  finishedAt: typeof row["finished_at"] === "string" ? row["finished_at"] : null,
});

const toLine = (row: Row): VersionLine => ({
  buildId: text(row["build_id"]) as Id,
  number: int(row["number"]),
  requestId: typeof row["request_id"] === "string" ? (row["request_id"] as Id) : null,
  madeBy: typeof row["made_by"] === "string" ? (row["made_by"] as Id) : null,
  summary: text(row["summary"]),
  chars: int(row["chars"]),
  createdAt: text(row["created_at"]),
});

const toVersion = (row: Row): BuildVersion => ({ ...toLine(row), filesJson: text(row["files"]) });

export function sqliteBuildStore(db: Database): BuildStore {
  const insertBuild = db.prepare("insert into build (id, organization_id, name, brief, created_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)");
  const saveBrief = db.prepare("update build set name = ?, brief = ?, updated_at = ? where id = ?");
  const touch = db.prepare("update build set updated_at = ? where id = ?");
  const getBuild = db.prepare("select id, organization_id, name, brief, created_by, created_at, updated_at, reference_from from build where id = ?");
  const setReference = db.prepare("update build set reference_from = ?, reference = ? where id = ?");
  const reference = db.prepare("select reference_from, reference from build where id = ?");
  const listBuilds = db.prepare(
    `select b.id, b.organization_id, b.name, b.brief, b.created_by, b.created_at, b.updated_at, b.reference_from, (select count(*) from build_version v where v.build_id = b.id) as versions,
            exists (select 1 from build_request r where r.build_id = b.id and r.state = 'working') as working
       from build b order by b.updated_at desc, b.name`,
  );
  const insertVersion = db.prepare("insert into build_version (build_id, number, request_id, made_by, summary, files, chars, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)");
  const versions = db.prepare("select build_id, number, request_id, made_by, summary, chars, created_at from build_version where build_id = ? order by number desc");
  const version = db.prepare("select * from build_version where build_id = ? and number = ?");
  const latest = db.prepare("select * from build_version where build_id = ? order by number desc limit 1");
  const insertRequest = db.prepare(
    "insert into build_request (id, build_id, asked_by, ask, model, state, reserved_micros, cost_micros, input_tokens, output_tokens, error, created_at, finished_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const finish = db.prepare("update build_request set state = ?, cost_micros = ?, input_tokens = ?, output_tokens = ?, error = ?, finished_at = ? where id = ? and state = 'working'");
  const request = db.prepare("select * from build_request where id = ?");
  const requests = db.prepare("select * from build_request where build_id = ? order by created_at, id");
  const working = db.prepare("select * from build_request where state = 'working' order by created_at");
  const since = db.prepare("select * from build_request where created_at >= ? order by created_at");
  return {
    insert(build) {
      insertBuild.run(build.id, build.organizationId, build.name, build.brief, build.createdBy, build.createdAt, build.createdAt);
    },
    setReference(id, from, value) {
      setReference.run(from, value, id);
    },
    reference(id) {
      const row = reference.get(id);
      return row && text(row["reference"]) ? { from: text(row["reference_from"]), text: text(row["reference"]) } : null;
    },
    saveBrief(id, name, brief, at) {
      saveBrief.run(name, brief, at, id);
    },
    get(id) {
      const row = getBuild.get(id);
      return row ? toBuild(row) : null;
    },
    list() {
      return listBuilds.all().map((row) => ({ ...toBuild(row), updatedAt: text(row["updated_at"]), versions: int(row["versions"]), working: int(row["working"]) === 1 }));
    },
    insertVersion(v) {
      insertVersion.run(v.buildId, v.number, v.requestId, v.madeBy, v.summary, v.filesJson, v.chars, v.createdAt);
      touch.run(v.createdAt, v.buildId);
    },
    versions(buildId) {
      return versions.all(buildId).map(toLine);
    },
    version(buildId, number) {
      const row = version.get(buildId, number);
      return row ? toVersion(row) : null;
    },
    latest(buildId) {
      const row = latest.get(buildId);
      return row ? toVersion(row) : null;
    },
    insertRequest(r) {
      insertRequest.run(r.id, r.buildId, r.askedBy, r.ask, r.model, r.state, r.reservedMicros, r.costMicros, r.inputTokens, r.outputTokens, r.error, r.createdAt, r.finishedAt);
      touch.run(r.createdAt, r.buildId);
    },
    finishRequest(id, f) {
      finish.run(f.state, f.costMicros, f.inputTokens, f.outputTokens, f.error, f.finishedAt, id);
    },
    request(id) {
      const row = request.get(id);
      return row ? toRequest(row) : null;
    },
    requests(buildId) {
      return requests.all(buildId).map(toRequest);
    },
    working() {
      return working.all().map(toRequest);
    },
    requestsSince(instant) {
      return since.all(instant).map(toRequest);
    },
  };
}

export function sqliteBuilderSettings(db: Database): BuilderSettingsStore {
  const read = db.prepare("select model, cap_cents from builder_settings where id = 1");
  const write = db.prepare("update builder_settings set model = ?, cap_cents = ?, updated_at = ? where id = 1");
  return {
    get() {
      const row = read.get() ?? {};
      return { model: text(row["model"]) || "claude-opus-5-5", capCents: int(row["cap_cents"]) || 1_000 };
    },
    save(settings, at) {
      write.run(settings.model, settings.capCents, at);
    },
  };
}

const IMAGE_COLUMNS = "id, build_id, path, kind, content_type, width, height, alt, size_bytes, added_by, created_at";
const toImage = (row: Row): BuildImage => ({
  id: text(row["id"]) as Id,
  buildId: text(row["build_id"]) as Id,
  path: text(row["path"]),
  kind: text(row["kind"]) as ImageKind,
  contentType: text(row["content_type"]),
  width: int(row["width"]),
  height: int(row["height"]),
  alt: text(row["alt"]),
  bytes: int(row["size_bytes"]),
  addedBy: text(row["added_by"]) as Id,
  createdAt: text(row["created_at"]),
});

export function sqliteImageStore(db: Database): ImageStore {
  const insert = db.prepare(`insert into build_image (${IMAGE_COLUMNS}, body) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const get = db.prepare(`select ${IMAGE_COLUMNS} from build_image where id = ?`);
  const atPath = db.prepare(`select ${IMAGE_COLUMNS} from build_image where build_id = ? and path = ?`);
  const body = db.prepare("select body from build_image where id = ?");
  const list = db.prepare(`select ${IMAGE_COLUMNS} from build_image where build_id = ? order by created_at, id`);
  const remove = db.prepare("delete from build_image where id = ?");
  return {
    insert(i, bytes) {
      insert.run(i.id, i.buildId, i.path, i.kind, i.contentType, i.width, i.height, i.alt, i.bytes, i.addedBy, i.createdAt, bytes);
    },
    get(id) {
      const row = get.get(id);
      return row ? toImage(row) : null;
    },
    atPath(buildId, path) {
      const row = atPath.get(buildId, path);
      return row ? toImage(row) : null;
    },
    body(id) {
      const value = body.get(id)?.["body"];
      return value instanceof Uint8Array ? value : null;
    },
    listFor(buildId) {
      return list.all(buildId).map(toImage);
    },
    remove(id) {
      remove.run(id);
    },
  };
}

export function sqlitePublishStore(db: Database): PublishStore {
  const insert = db.prepare("insert into build_publish (id, build_id, version, kind, repo, branch, commit_sha, url, published_by, published_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const list = db.prepare("select * from build_publish where build_id = ? order by published_at desc, version desc");
  return {
    insert(p) {
      insert.run(p.id, p.buildId, p.version, p.kind, p.repo, p.branch, p.commit, p.url, p.by, p.at);
    },
    listFor(buildId) {
      return list.all(buildId).map((row): Publish => ({
        id: text(row["id"]) as Id,
        buildId: text(row["build_id"]) as Id,
        version: int(row["version"]),
        kind: text(row["kind"]) as Publish["kind"],
        repo: text(row["repo"]),
        branch: text(row["branch"]),
        commit: text(row["commit_sha"]),
        url: text(row["url"]),
        by: text(row["published_by"]) as Id,
        at: text(row["published_at"]),
      }));
    },
  };
}
