// The one authorization check. Every application service calls it before
// doing anything (docs/authorization-matrix.md, "Rules").
import { isPermission, type Permission } from "./permissions.ts";
import type { User } from "./user.ts";

/** A stored user together with the permissions their stored roles grant. */
export type Access = {
  readonly user: User;
  readonly permissions: ReadonlySet<Permission>;
};

/**
 * May this user take this action on this record?
 *
 * - Deny by default: an action that is not a known permission is refused.
 * - A disabled user can do nothing, whatever roles they hold.
 * - A missing user can do nothing.
 *
 * The record is accepted now so that every caller already passes it.
 * Record-level limits arrive with the client portal.
 */
export function can(access: Access | null, action: string, _record?: unknown): boolean {
  if (access === null) return false;
  if (access.user.status !== "active") return false;
  if (!isPermission(action)) return false;
  return access.permissions.has(action);
}
