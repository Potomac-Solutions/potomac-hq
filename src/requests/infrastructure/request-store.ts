import type { Database } from "../../shared/adapters.ts";
import type { ClientRequest } from "../domain/request.ts";
import type { RequestStore } from "../application/requests.ts";
import type { Id } from "../../shared/index.ts";

type Row = Record<string, unknown>;
const toRequest = (r: Row): ClientRequest => ({
  id: r["id"] as Id,
  organizationId: r["organization_id"] as Id,
  projectId: (r["project_id"] as Id | null) ?? null,
  clientUserId: r["client_user_id"] as Id,
  title: r["title"] as string,
  details: r["details"] as string,
  taskId: (r["task_id"] as Id | null) ?? null,
  declinedNote: r["declined_note"] as string,
  declinedAt: (r["declined_at"] as string | null) ?? null,
  createdAt: r["created_at"] as string,
});

export function sqliteRequestStore(db: Database): RequestStore {
  const cols = "id, organization_id, project_id, client_user_id, title, details, task_id, declined_note, declined_at, created_at";
  const insert = db.prepare(`insert into client_request (${cols}) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const get = db.prepare(`select ${cols} from client_request where id = ?`);
  const forClient = db.prepare(`select ${cols} from client_request where organization_id = ? order by created_at desc, rowid desc limit 200`);
  const decline = db.prepare("update client_request set declined_note = ?, declined_at = ?, declined_by = ? where id = ?");
  const since = db.prepare("select count(*) as n from client_request where client_user_id = ? and created_at >= ?");
  return {
    insert: (r) => void insert.run(r.id, r.organizationId, r.projectId, r.clientUserId, r.title, r.details, r.taskId, r.declinedNote, r.declinedAt, r.createdAt),
    get: (id) => {
      const row = get.get(id) as Row | undefined;
      return row ? toRequest(row) : null;
    },
    forClient: (organizationId) => (forClient.all(organizationId) as Row[]).map(toRequest),
    decline: (id, note, by, at) => void decline.run(note, at, by, id),
    countSince: (clientUserId, at) => ((since.get(clientUserId, at) as Row)["n"] as number) ?? 0,
  };
}

/** What requests read about the rest of HQ: a client's open projects, who looks after them, a task's status. */
export function sqliteRequestLookups(db: Database) {
  const projects = db.prepare("select id, name from project where organization_id = ? and status = 'active' order by name");
  const projectOwner = db.prepare("select owner_id from project where id = ?");
  // The client's latest project or deal owner, else the first admin.
  const clientOwner = db.prepare(
    `select owner_id from (
       select owner_id, created_at from project where organization_id = ?1
       union all select owner_id, created_at from opportunity where organization_id = ?1
     ) order by created_at desc limit 1`,
  );
  const firstAdmin = db.prepare("select u.id from user u join user_role ur on ur.user_id = u.id join role r on r.id = ur.role_id where r.key = 'admin' and u.status = 'active' order by u.created_at limit 1");
  const status = db.prepare("select status from task where id = ?");
  const name = db.prepare("select name from client_organization where id = ?");
  return {
    projectName: (projectId: Id) => ((db.prepare("select name from project where id = ?").get(projectId) as Row | undefined)?.["name"] as string | undefined) ?? null,
    projectsOf: (organizationId: Id) => (projects.all(organizationId) as Row[]).map((r) => ({ id: r["id"] as Id, name: r["name"] as string })),
    ownerFor: (organizationId: Id, projectId: Id | null): Id | null =>
      ((projectId ? (projectOwner.get(projectId) as Row | undefined)?.["owner_id"] : null) ??
        (clientOwner.get(organizationId) as Row | undefined)?.["owner_id"] ??
        (firstAdmin.get() as Row | undefined)?.["id"] ??
        null) as Id | null,
    taskStatus: (taskId: Id) => ((status.get(taskId) as Row | undefined)?.["status"] as string | undefined) ?? null,
    clientName: (organizationId: Id) => ((name.get(organizationId) as Row | undefined)?.["name"] as string | undefined) ?? "",
  };
}
