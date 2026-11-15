// Public entry for the projects module. In v0.2 a project is a stub made from
// a won opportunity; v0.3 fills it in.
export { changeProjectStatus, projectFromWon, PROJECT_KINDS, PROJECT_STATUSES, type Project, type ProjectKind, type ProjectStatus, type WonOpportunity } from "./domain/project.ts";
export type { ProjectStore } from "./application/ports.ts";
export { projectDetail, type ProjectDetailDeps, type ProjectDetailView } from "./application/project-detail.ts";
