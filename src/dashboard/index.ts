// Public entry for the dashboard module.
export { recentActivity, type ActivityFeedView, type ActivityItemView, type RecentActivityDeps } from "./application/recent-activity.ts";
export type { ActivityReader, ActivityRow } from "./application/ports.ts";
export { auditHistory, auditTable, type AuditDeps, type AuditTable, type AuditView } from "./application/audit-history.ts";
export type { AuditFilter, AuditReader, AuditRow } from "./application/ports.ts";
