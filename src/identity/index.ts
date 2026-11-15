// Public entry for the identity module (users, roles, sign-in). Other modules
// import from here only.
export { can, type Access } from "./domain/access.ts";
export { isPermission, isRoleKey, PERMISSIONS, ROLE_GRANTS, ROLE_KEYS, type Permission, type RoleKey } from "./domain/permissions.ts";
export type { User, UserError, UserStatus } from "./domain/user.ts";
export { authorize, type Forbidden } from "./application/authorize.ts";
export { createFirstAdmin, type CreateFirstAdminDeps, type CreateFirstAdminError } from "./application/create-first-admin.ts";
export type { UserStore } from "./application/ports.ts";
export { establishUser, recordSessionEvent, type SessionDeps, type SessionEvent, type SignedInAccount } from "./application/session.ts";
export type { RateLimit, UserStore as IdentityUserStore } from "./application/ports.ts";
