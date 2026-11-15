// The project stub's page. Permission: project.view. Reading writes no event.
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, type Id, type Result } from "../../shared/index.ts";
import type { ProjectStore } from "./ports.ts";

export type ProjectDetailView = {
  readonly project: { readonly id: string; readonly name: string; readonly kindLabel: string; readonly statusLabel: string };
  readonly clientId: string;
  readonly opportunityId: string;
};

export type ProjectDetailDeps = { readonly users: IdentityUserStore; readonly projects: ProjectStore };

const KIND = { fixed: "One-time work", ongoing: "Ongoing plan" } as const;
const STATUS = { active: "Active", completed: "Completed", cancelled: "Cancelled" } as const;

export function projectDetail(deps: ProjectDetailDeps, actorId: Id | null, projectId: Id): Result<ProjectDetailView, "forbidden" | "not-found"> {
  if (actorId === null || !authorize(deps, actorId, "project.view").ok) return err("forbidden");
  const project = deps.projects.get(projectId);
  if (!project) return err("not-found");
  return ok({
    project: { id: project.id, name: project.name, kindLabel: KIND[project.kind], statusLabel: STATUS[project.status] },
    clientId: project.organizationId,
    opportunityId: project.opportunityId,
  });
}
