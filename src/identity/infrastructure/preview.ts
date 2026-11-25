// View as a role (quality of life, 2026-11-25): an admin sees HQ as a
// manager or a member would, read-only, to check what each can see. While a
// request runs inside a preview, the admin's own access is answered with the
// role's permissions instead; nothing else changes, and the app refuses every
// change while it lasts. Only someone whose real access may set roles is ever
// put in a preview (the app checks before it starts one).
import { AsyncLocalStorage } from "node:async_hooks";
import { isPermission, type Permission } from "../domain/permissions.ts";
import type { UserStore as IdentityUserStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

export const PREVIEW_ROLES = ["manager", "member"] as const;
export type PreviewRole = (typeof PREVIEW_ROLES)[number];
export const isPreviewRole = (value: string): value is PreviewRole => (PREVIEW_ROLES as readonly string[]).includes(value);

const scope = new AsyncLocalStorage<{ readonly userId: Id; readonly role: PreviewRole }>();

/** Runs `fn` with this person seeing HQ as the role. */
export const runPreviewing = <T>(userId: Id, role: PreviewRole, fn: () => T): T => scope.run({ userId, role }, fn);

/** The preview this request runs in, or null. */
export const previewing = (): { readonly userId: Id; readonly role: PreviewRole } | null => scope.getStore() ?? null;

/** The user store, answering a previewing person's access with the role's permissions from the database. */
export function withRolePreview(db: Database, store: IdentityUserStore): IdentityUserStore {
  const grants = db.prepare("select rp.permission from role_permission rp join role r on r.id = rp.role_id where r.key = ?");
  const permissionsOf = (role: PreviewRole): ReadonlySet<Permission> => new Set((grants.all(role) as { permission: string }[]).map((row) => row.permission).filter(isPermission));
  return {
    ...store,
    accessFor(userId) {
      const real = store.accessFor(userId);
      const preview = scope.getStore();
      return real && preview && preview.userId === userId ? { user: real.user, permissions: permissionsOf(preview.role) } : real;
    },
    rolesOf(userId) {
      const preview = scope.getStore();
      return preview && preview.userId === userId ? [preview.role] : store.rolesOf(userId);
    },
  };
}
