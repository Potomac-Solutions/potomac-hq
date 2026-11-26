import type { Database } from "../../shared/adapters.ts";
import type { FeedbackStore } from "../application/feedback.ts";
import type { Id } from "../../shared/index.ts";

type Row = Record<string, unknown>;

export function sqliteFeedbackStore(db: Database): FeedbackStore {
  const get = db.prepare("select project_id, client_user_id, score, note, todo_id, created_at from project_feedback where project_id = ?");
  const insert = db.prepare("insert into project_feedback (project_id, client_user_id, score, note, todo_id, created_at) values (?, ?, ?, ?, ?, ?)");
  const waiting = db.prepare(
    `select p.id, p.name, p.owner_id from project p left join project_feedback f on f.project_id = p.id
      where p.organization_id = ? and p.status = 'completed' and f.project_id is null order by p.updated_at desc limit 3`,
  );
  const project = db.prepare("select id, name, organization_id, owner_id, status from project where id = ?");
  const latest = db.prepare("select f.score from project_feedback f join project p on p.id = f.project_id where p.organization_id = ? order by f.created_at desc limit 1");
  return {
    latestScore: (organizationId) => ((latest.get(organizationId) as Row | undefined)?.["score"] as number | undefined) ?? null,
    get: (projectId) => {
      const r = get.get(projectId) as Row | undefined;
      return r ? { projectId: r["project_id"] as Id, clientUserId: r["client_user_id"] as Id, score: r["score"] as number, note: r["note"] as string, todoId: (r["todo_id"] as Id | null) ?? null, createdAt: r["created_at"] as string } : null;
    },
    insert: (f) => void insert.run(f.projectId, f.clientUserId, f.score, f.note, f.todoId, f.createdAt),
    waiting: (organizationId) => (waiting.all(organizationId) as Row[]).map((r) => ({ id: r["id"] as Id, name: r["name"] as string, ownerId: r["owner_id"] as Id })),
    projectOf: (projectId) => {
      const r = project.get(projectId) as Row | undefined;
      return r ? { id: r["id"] as Id, name: r["name"] as string, organizationId: r["organization_id"] as Id, ownerId: r["owner_id"] as Id, status: r["status"] as string } : null;
    },
  };
}
