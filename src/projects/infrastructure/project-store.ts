import type { ProjectStore } from "../application/ports.ts";
import type { Project, ProjectKind, ProjectStatus } from "../domain/project.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

type Row = { id: string; organization_id: string; opportunity_id: string; owner_id: string; name: string; kind: string; status: string };

const toProject = (row: Row): Project => ({
  id: row.id as Id,
  organizationId: row.organization_id as Id,
  opportunityId: row.opportunity_id as Id,
  ownerId: row.owner_id as Id,
  name: row.name,
  kind: row.kind as ProjectKind,
  status: row.status as ProjectStatus,
});

export function sqliteProjectStore(db: Database): ProjectStore {
  const columns = "id, organization_id, opportunity_id, owner_id, name, kind, status";
  const insert = db.prepare(`insert into project (${columns}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const byId = db.prepare(`select ${columns} from project where id = ?`);
  const byOpportunity = db.prepare(`select ${columns} from project where opportunity_id = ?`);
  return {
    insert(p, at) {
      insert.run(p.id, p.organizationId, p.opportunityId, p.ownerId, p.name, p.kind, p.status, at, at);
    },
    get(id) {
      const row = byId.get(id) as Row | undefined;
      return row ? toProject(row) : null;
    },
    byOpportunity(id) {
      const row = byOpportunity.get(id) as Row | undefined;
      return row ? toProject(row) : null;
    },
  };
}
