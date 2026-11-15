import type { Access } from "../domain/access.ts";
import type { RoleKey } from "../domain/permissions.ts";
import type { User } from "../domain/user.ts";
import type { Id } from "../../shared/index.ts";

export type UserStore = {
  /** How many users exist, of any status. */
  count(): number;
  /** Saves a new user with these roles. */
  insert(user: User, roles: readonly RoleKey[], at: string): void;
  /** The stored user and the permissions their stored roles grant, or null. */
  accessFor(userId: Id): Access | null;
  /** The user who signs in with this kit staff account, or null. */
  findByStaffAccount(staffAccount: string): User | null;
};
