import type { FreePage, PageStatus, Round } from "../domain/free-page.ts";
import type { FreePageStore, RoundStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const PAGE = "id, organization_id, subdomain, own_domain, status, repo_owner, repo_name, repo_branch, approved_at";
const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

function toPage(row: Record<string, unknown>): FreePage {
  const owner = text(row["repo_owner"]);
  return {
    id: row["id"] as Id,
    organizationId: row["organization_id"] as Id,
    subdomain: text(row["subdomain"]),
    ownDomain: text(row["own_domain"]),
    status: row["status"] as PageStatus,
    repo: owner ? { owner, name: String(row["repo_name"]), branch: String(row["repo_branch"]) } : null,
    approvedAt: text(row["approved_at"]),
  };
}

export function sqliteFreePageStore(db: Database): FreePageStore {
  const get = db.prepare(`select ${PAGE} from free_page where id = ?`);
  const byOrg = db.prepare(`select ${PAGE} from free_page where organization_id = ?`);
  const bySub = db.prepare(`select ${PAGE} from free_page where subdomain = ?`);
  const byDomain = db.prepare(`select ${PAGE} from free_page where own_domain = ?`);
  const list = db.prepare(`select ${PAGE} from free_page order by created_at desc`);
  const insert = db.prepare(`insert into free_page (${PAGE}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const save = db.prepare("update free_page set subdomain = ?, own_domain = ?, status = ?, repo_owner = ?, repo_name = ?, repo_branch = ?, approved_at = ?, updated_at = ? where id = ?");
  const one = (row: Record<string, unknown> | undefined) => (row ? toPage(row) : null);
  return {
    get: (id) => one(get.get(id)),
    forOrganization: (organizationId) => one(byOrg.get(organizationId)),
    bySubdomain: (subdomain) => one(bySub.get(subdomain)),
    byOwnDomain: (domain) => one(byDomain.get(domain)),
    list: () => list.all().map(toPage),
    insert(page, at) {
      insert.run(page.id, page.organizationId, page.subdomain, page.ownDomain, page.status, page.repo?.owner ?? null, page.repo?.name ?? null, page.repo?.branch ?? null, page.approvedAt, at, at);
    },
    save(page, at) {
      save.run(page.subdomain, page.ownDomain, page.status, page.repo?.owner ?? null, page.repo?.name ?? null, page.repo?.branch ?? null, page.approvedAt, at, page.id);
    },
  };
}

const ROUND = "id, free_page_id, number, text, free, origin, done_at, created_at";

function toRound(row: Record<string, unknown>): Round {
  return { id: row["id"] as Id, freePageId: row["free_page_id"] as Id, number: Number(row["number"]), text: String(row["text"]), free: Number(row["free"]) === 1, from: row["origin"] as Round["from"], doneAt: text(row["done_at"]), createdAt: String(row["created_at"]) };
}

export function sqliteRoundStore(db: Database): RoundStore {
  const listFor = db.prepare(`select ${ROUND} from free_page_round where free_page_id = ? order by number`);
  const get = db.prepare(`select ${ROUND} from free_page_round where id = ?`);
  const insert = db.prepare(`insert into free_page_round (${ROUND}, client_user_id, user_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const done = db.prepare("update free_page_round set done_at = ?, done_by = ? where id = ? and done_at is null");
  const open = db.prepare(`select ${ROUND} from free_page_round where done_at is null order by created_at`);
  return {
    listFor: (freePageId) => listFor.all(freePageId).map(toRound),
    get(id) {
      const row = get.get(id);
      return row ? toRound(row) : null;
    },
    insert(round, who) {
      insert.run(round.id, round.freePageId, round.number, round.text, round.free ? 1 : 0, round.from, round.doneAt, round.createdAt, "clientUserId" in who ? who.clientUserId : null, "userId" in who ? who.userId : null);
    },
    markDone(id, userId, at) {
      done.run(at, userId, id);
    },
    open: () => open.all().map(toRound),
  };
}
