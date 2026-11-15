// Ties a signed-in kit account to an HQ user, and records what happens to
// sessions. Signing in and out need no permission (authorization matrix:
// "Sign in and sign out", key "none"), but each writes an activity event.
import type { User } from "../domain/user.ts";
import { recordActivity, type ActivityDeps, type Transact } from "../../shared/index.ts";
import { createFirstAdmin } from "./create-first-admin.ts";
import type { UserStore } from "./ports.ts";

export type SessionDeps = ActivityDeps & {
  readonly users: UserStore;
  readonly transact: Transact;
};

/** Who the kit says is signed in. */
export type SignedInAccount = {
  readonly account: string;
  readonly name: string;
  readonly email: string;
  readonly isOwner: boolean;
};

/**
 * The HQ user for a signed-in account, or null if there is none.
 *
 * The first time the kit's first owner arrives and HQ has no users, that
 * person becomes HQ's first admin. Nobody else is created this way: an
 * account with no HQ user can sign in but is refused every action.
 */
export function establishUser(deps: SessionDeps, who: SignedInAccount): User | null {
  const existing = deps.users.findByStaffAccount(who.account);
  if (existing) return existing.status === "active" ? existing : null;
  if (!who.isOwner) return null;
  const created = createFirstAdmin(deps, { staffAccount: who.account, name: who.name, email: who.email });
  return created.ok ? created.value : null;
}

export type SessionEvent = "user.signed-in" | "user.signed-out" | "user.password-changed";

export function recordSessionEvent(deps: SessionDeps, user: User, action: SessionEvent): void {
  deps.transact(() => {
    recordActivity(deps, { actorId: user.id, action, recordType: "user", recordId: user.id });
  });
}
