// Public entry for the projects module: a project's details, plan, tasks,
// deliverables and history.
export { changeProjectStatus, projectFromWon, PROJECT_HEALTHS, PROJECT_KINDS, PROJECT_STATUSES, type Project, type ProjectHealth, type ProjectKind, type ProjectStatus, type WonOpportunity } from "./domain/project.ts";
export { decideDeliverable, isClientVisible, type Deliverable, type DeliverableStatus } from "./domain/deliverable.ts";
export { isMilestoneOverdue, milestoneProgress, nextMilestone, type Milestone, type Phase } from "./domain/plan.ts";
export { formatHours, parseHours, type Task } from "./domain/task.ts";
export { LABEL_COLOUR_NAMES, LABEL_COLOURS, type Label, type LabelColour } from "./domain/label.ts";
export { DELIVERABLE_STATUS_LABELS, HEALTH_LABELS, KIND_LABELS, STATUS_LABELS } from "./domain/labels.ts";
export type { Baseline, BaselineLine } from "./domain/baseline.ts";
export { LINK_KIND_LABELS, LINK_KINDS, linkName, newProjectLink, type LinkKind, type ProjectLink } from "./domain/link.ts";
export type { BaselineStore, DeliverableRow, DeliverableStore, LabelRow, LabelStore, WorkRow, WorkStore, ProjectLinkStore, MilestoneStore, PhaseStore, ProjectHistory, ProjectRow, ProjectStore, TaskRow, TaskStore } from "./application/ports.ts";
export * from "./application/commands.ts";
export * from "./application/queries.ts";
export * from "./application/work.ts";
export * from "./application/quick-add.ts";
export * from "./application/dependencies.ts";
export * from "./application/comments.ts";
export * from "./application/repeating.ts";
export * from "./application/timeline.ts";
