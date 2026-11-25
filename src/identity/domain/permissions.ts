// Every action HQ knows about, and which role may take it. This is the code
// form of docs/authorization-matrix.md. A test keeps the two, and the seeded
// database rows, identical.

export const PERMISSIONS = [
  "user.view",
  "user.invite",
  "user.set-status",
  "user.set-roles",
  "user.reset",
  "dashboard.view",
  "activity.view",
  "activity.view-all",
  "client.view",
  "client.create",
  "client.edit",
  "client.set-status",
  "contact.edit",
  "opportunity.view",
  "opportunity.view-value",
  "opportunity.set-value",
  "opportunity.create",
  "opportunity.edit",
  "opportunity.set-stage",
  "opportunity.set-follow-up",
  "opportunity.set-owner",
  "opportunity.convert",
  "project.view",
  "project.edit",
  "project.set-status",
  "project.set-owner",
  // v0.3
  "project.plan",
  "task.view",
  "task.edit",
  "note.view",
  "note.add",
  "file.upload",
  "file.download",
  "deliverable.edit",
  // v0.4
  "proposal.view",
  "proposal.edit",
  "proposal.send",
  "proposal.decide",
  // v0.5
  "time.log",
  "time.view-all",
  "expense.edit",
  "finance.view",
  "finance.edit",
  "finance.export",
  "invoice.view",
  "invoice.edit",
  "payment.record",
  // v0.6
  "portal.view",
  "portal.manage",
  "project.post-update",
  "call.respond",
  // v1.0
  "knowledge.view",
  "knowledge.edit",
  "report.view",
  // After 0.11.0
  "booking.manage",
  // After 0.13.0
  "referral.manage",
  "site.publish",
  // Potomac's own website
  "public-site.view",
  "public-site.edit",
  // Task management (decision 0007)
  "label.manage",
  "project.share",
  "webhook.manage",
  // The site builder (decision 0010)
  "site.build",
  // Social media (decision 0011)
  "social.view",
  "social.edit",
  // AI assistance (decision 0012)
  "ai.manage",
  // Growth tools (decision 0013)
  "newsletter.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_KEYS = ["admin", "manager", "member"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

const ADMIN_ONLY: readonly Permission[] = [
  "user.invite",
  "user.set-status",
  "user.set-roles",
  "user.reset",
  "activity.view-all",
  "public-site.view",
  "public-site.edit",
  "webhook.manage",
  "site.build",
  "ai.manage",
];

const MANAGER_AND_UP: readonly Permission[] = [
  "opportunity.view-value",
  "opportunity.set-value",
  "opportunity.set-owner",
  "project.set-owner",
  "proposal.view",
  "proposal.edit",
  "proposal.send",
  "proposal.decide",
  "time.view-all",
  "expense.edit",
  "finance.view",
  "finance.edit",
  "finance.export",
  "invoice.view",
  "invoice.edit",
  "payment.record",
  "portal.manage",
  "knowledge.edit",
  "report.view",
  "booking.manage",
  "referral.manage",
  "site.publish",
  "label.manage",
  "project.share",
  "newsletter.manage",
];

export const ROLE_GRANTS: { readonly [K in RoleKey]: readonly Permission[] } = {
  admin: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => !ADMIN_ONLY.includes(p)),
  member: PERMISSIONS.filter((p) => !ADMIN_ONLY.includes(p) && !MANAGER_AND_UP.includes(p)),
};

export function isPermission(action: string): action is Permission {
  return (PERMISSIONS as readonly string[]).includes(action);
}

export function isRoleKey(key: string): key is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(key);
}
