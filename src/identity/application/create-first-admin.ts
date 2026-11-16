// Creates the very first user, as an admin. It works only while HQ has no
// users at all, which is its authorization: there is nobody yet who could
// hold a permission. After that, new users come by invitation from an admin.
import { newUser, type User, type UserError } from "../domain/user.ts";
import { err, ok, recordActivity, type ActivityDeps, type Result, type Transact } from "../../shared/index.ts";
import type { UserStore } from "./ports.ts";

export type CreateFirstAdminDeps = ActivityDeps & {
  readonly users: UserStore;
  readonly transact: Transact;
};

export type CreateFirstAdminError = "already-set-up" | UserError;

export function createFirstAdmin(
  deps: CreateFirstAdminDeps,
  input: { readonly staffAccount: string; readonly name: string; readonly email: string },
): Result<User, CreateFirstAdminError> {
  return deps.transact(() => {
    // Permission: allowed only while there are no users. Checked inside the
    // transaction, so two requests at once cannot both pass.
    if (deps.users.count() > 0) return err("already-set-up");

    const user = newUser({ id: deps.newId(), ...input });
    if (!user.ok) return user;

    deps.users.insert(user.value, ["admin"], deps.clock());
    recordActivity(deps, {
      actorId: user.value.id,
      action: "user.created",
      recordType: "user",
      recordId: user.value.id,
      context: { roles: ["admin"], first: true },
    });
    return ok(user.value);
  });
}
