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
];

const MANAGER_AND_UP: readonly Permission[] = [
  "opportunity.view-value",
  "opportunity.set-value",
  "opportunity.set-owner",
  "project.set-owner",
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
