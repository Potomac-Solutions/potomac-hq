// A person who signs in to HQ (docs/data-model.md, "User").
import type { Id } from "../../shared/domain/id.ts";
import { isRoleKey, ROLE_KEYS, type RoleKey } from "./permissions.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type UserStatus = "active" | "disabled";

export type User = {
  readonly id: Id;
  /** The kit staff account this user signs in with. */
  readonly staffAccount: string;
  readonly name: string;
  /** Stored lower-case. */
  readonly email: string;
  readonly status: UserStatus;
};

export type UserError = "invalid-name" | "invalid-email" | "invalid-staff-account";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function newUser(input: {
  readonly id: Id;
  readonly staffAccount: string;
  readonly name: string;
  readonly email: string;
}): Result<User, UserError> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const staffAccount = input.staffAccount.trim();
  if (name.length === 0 || name.length > 200) return err("invalid-name");
  if (email.length > 254 || !EMAIL.test(email)) return err("invalid-email");
  if (staffAccount.length === 0) return err("invalid-staff-account");
  return ok({ id: input.id, staffAccount, name, email, status: "active" });
}

/** Someone invited to HQ who has not used their link yet. */
export type UserInvite = {
  readonly id: Id;
  readonly name: string;
  readonly email: string;
  readonly roles: readonly RoleKey[];
  readonly invitedBy: Id;
};

export type RolesError = "invalid-roles";

/** The roles asked for, in the fixed order, each once. At least one. */
export function cleanRoles(given: readonly string[]): Result<RoleKey[], RolesError> {
  if (given.length === 0 || !given.every(isRoleKey)) return err("invalid-roles");
  return ok(ROLE_KEYS.filter((key) => given.includes(key)));
}

export function newInvite(input: { readonly id: Id; readonly invitedBy: Id; readonly name: string; readonly email: string; readonly roles: readonly string[] }): Result<UserInvite, UserError | RolesError> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length === 0 || name.length > 200) return err("invalid-name");
  if (email.length > 254 || !EMAIL.test(email)) return err("invalid-email");
  const roles = cleanRoles(input.roles);
  if (!roles.ok) return roles;
  return ok({ id: input.id, invitedBy: input.invitedBy, name, email, roles: roles.value });
}

export type ChangeRefused = "last-admin" | "yourself";

/**
 * HQ always has an admin who can sign in. This refuses a change that would
 * leave none: disabling the last active admin, or taking the role from them.
 * `otherActiveAdmins` counts active admins other than the person changed.
 */
export function mayStopBeingAdmin(person: { readonly isAdmin: boolean; readonly status: UserStatus }, otherActiveAdmins: number): boolean {
  return !(person.isAdmin && person.status === "active") || otherActiveAdmins > 0;
}
