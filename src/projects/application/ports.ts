import type { Project } from "../domain/project.ts";
import type { Id } from "../../shared/index.ts";

export type ProjectStore = {
  insert(project: Project, at: string): void;
  get(id: Id): Project | null;
  byOpportunity(opportunityId: Id): Project | null;
};
