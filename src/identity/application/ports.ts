import type { Access } from "../domain/access.ts";
import type { RoleKey } from "../domain/permissions.ts";
import type { Theme } from "../domain/theme.ts";
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
  get(userId: Id): User | null;
  /** Every user, by name. */
  list(): User[];
  /** The theme a user chose, or "system" if they never chose. */
  themeOf(userId: Id): Theme;
  setTheme(userId: Id, theme: Theme, at: string): void;
};

/** True if this key may make another attempt now. */
export type RateLimit = (key: string) => boolean;
